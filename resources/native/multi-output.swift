import CoreAudio
import Foundation

let multiOutputName = "Kataribe Multi-Output"

func propertyAddress(
    _ selector: AudioObjectPropertySelector,
    scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal
) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: scope,
        mElement: kAudioObjectPropertyElementMain
    )
}

func allDevices() -> [AudioDeviceID] {
    var property = propertyAddress(kAudioHardwarePropertyDevices)
    var size: UInt32 = 0
    let system = AudioObjectID(kAudioObjectSystemObject)
    guard AudioObjectGetPropertyDataSize(system, &property, 0, nil, &size) == noErr else {
        return []
    }
    let count = Int(size) / MemoryLayout<AudioDeviceID>.size
    var ids = [AudioDeviceID](repeating: 0, count: count)
    guard AudioObjectGetPropertyData(system, &property, 0, nil, &size, &ids) == noErr else {
        return []
    }
    return ids
}

func stringProperty(_ id: AudioDeviceID, _ selector: AudioObjectPropertySelector) -> String {
    var property = propertyAddress(selector)
    var value: CFString = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    guard AudioObjectGetPropertyData(id, &property, 0, nil, &size, &value) == noErr else {
        return ""
    }
    return value as String
}

func uint32Property(_ id: AudioDeviceID, _ selector: AudioObjectPropertySelector) -> UInt32 {
    var property = propertyAddress(selector)
    var value: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    guard AudioObjectGetPropertyData(id, &property, 0, nil, &size, &value) == noErr else {
        return 0
    }
    return value
}

func deviceName(_ id: AudioDeviceID) -> String {
    stringProperty(id, kAudioObjectPropertyName)
}

func deviceUID(_ id: AudioDeviceID) -> String {
    stringProperty(id, kAudioDevicePropertyDeviceUID)
}

func outputChannelCount(_ id: AudioDeviceID) -> Int {
    var property = propertyAddress(
        kAudioDevicePropertyStreamConfiguration,
        scope: kAudioObjectPropertyScopeOutput
    )
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(id, &property, 0, nil, &size) == noErr, size > 0 else {
        return 0
    }
    let raw = UnsafeMutableRawPointer.allocate(
        byteCount: Int(size),
        alignment: MemoryLayout<AudioBufferList>.alignment
    )
    defer { raw.deallocate() }
    guard AudioObjectGetPropertyData(id, &property, 0, nil, &size, raw) == noErr else {
        return 0
    }
    let list = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
    return list.reduce(0) { $0 + Int($1.mNumberChannels) }
}

func currentDefaultOutput() -> AudioDeviceID {
    var property = propertyAddress(kAudioHardwarePropertyDefaultOutputDevice)
    var value = AudioDeviceID(0)
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject),
        &property,
        0,
        nil,
        &size,
        &value
    )
    return value
}

func setDefaultDevice(_ selector: AudioObjectPropertySelector, id: AudioDeviceID) -> Bool {
    var property = propertyAddress(selector)
    var value = id
    let status = AudioObjectSetPropertyData(
        AudioObjectID(kAudioObjectSystemObject),
        &property,
        0,
        nil,
        UInt32(MemoryLayout<AudioDeviceID>.size),
        &value
    )
    return status == noErr
}

func deviceInfo(_ id: AudioDeviceID) -> [String: Any] {
    let name = deviceName(id)
    let transport = uint32Property(id, kAudioDevicePropertyTransportType)
    return [
        "id": Int(id),
        "name": name,
        "uid": deviceUID(id),
        "channels": outputChannelCount(id),
        "isBlackHole": name.localizedCaseInsensitiveContains("BlackHole"),
        "isAggregate": transport == kAudioDeviceTransportTypeAggregate,
        "isMultiOutput": name == multiOutputName,
    ]
}

func outputDevices() -> [[String: Any]] {
    allDevices()
        .filter { outputChannelCount($0) > 0 }
        .map(deviceInfo)
}

func findDeviceByUID(_ uid: String) -> AudioDeviceID? {
    allDevices().first { deviceUID($0) == uid }
}

func removeExistingAggregate() -> Int {
    var removed = 0
    for id in allDevices() {
        guard deviceName(id) == multiOutputName else {
            continue
        }
        if AudioHardwareDestroyAggregateDevice(id) == noErr {
            removed += 1
        }
    }
    return removed
}

func createAggregate(outputUID: String, blackHoleUID: String) -> AudioDeviceID? {
    guard let output = findDeviceByUID(outputUID), outputChannelCount(output) > 0 else {
        fputs("output device not found\n", stderr)
        return nil
    }
    guard let blackHole = findDeviceByUID(blackHoleUID) else {
        fputs("BlackHole device not found\n", stderr)
        return nil
    }
    _ = blackHole
    _ = removeExistingAggregate()

    let description: [String: Any] = [
        kAudioAggregateDeviceNameKey as String: multiOutputName,
        kAudioAggregateDeviceUIDKey as String: UUID().uuidString,
        kAudioAggregateDeviceMainSubDeviceKey as String: outputUID,
        kAudioAggregateDeviceIsPrivateKey as String: false,
        kAudioAggregateDeviceIsStackedKey as String: true,
        kAudioAggregateDeviceSubDeviceListKey as String: [
            [kAudioSubDeviceUIDKey as String: outputUID],
            [kAudioSubDeviceUIDKey as String: blackHoleUID],
        ],
    ]

    var aggregateID = AudioDeviceID(0)
    let status = AudioHardwareCreateAggregateDevice(
        description as CFDictionary,
        &aggregateID
    )
    guard status == noErr, aggregateID != 0 else {
        fputs("AudioHardwareCreateAggregateDevice failed: \(status)\n", stderr)
        return nil
    }

    _ = setDefaultDevice(kAudioHardwarePropertyDefaultOutputDevice, id: aggregateID)
    _ = setDefaultDevice(kAudioHardwarePropertyDefaultSystemOutputDevice, id: aggregateID)

    for _ in 0..<20 {
        if let actual = allDevices().first(where: { deviceName($0) == multiOutputName }) {
            return actual
        }
        Thread.sleep(forTimeInterval: 0.1)
    }
    return aggregateID
}

func printJSON(_ value: Any) {
    guard JSONSerialization.isValidJSONObject(value),
          let data = try? JSONSerialization.data(withJSONObject: value),
          let text = String(data: data, encoding: .utf8) else {
        fputs("failed to encode JSON\n", stderr)
        exit(1)
    }
    print(text)
}

@main
struct Main {
    static func main() {
        let arguments = CommandLine.arguments
        let command = arguments.count > 1 ? arguments[1] : "list"
        let current = currentDefaultOutput()

        switch command {
        case "list":
            let currentInfo: Any = current == 0 ? NSNull() : deviceInfo(current)
            printJSON([
                "currentOutput": currentInfo,
                "devices": outputDevices(),
            ])
        case "create":
            guard arguments.count > 3 else {
                fputs("usage: kataribe-multi-output create <output-uid> <blackhole-uid>\n", stderr)
                exit(2)
            }
            guard let id = createAggregate(
                outputUID: arguments[2],
                blackHoleUID: arguments[3]
            ) else {
                exit(1)
            }
            printJSON(deviceInfo(id))
        case "remove":
            let removed = removeExistingAggregate()
            printJSON(["removed": removed])
        default:
            fputs("usage: kataribe-multi-output list|create <output-uid> <blackhole-uid>|remove\n", stderr)
            exit(2)
        }
    }
}
