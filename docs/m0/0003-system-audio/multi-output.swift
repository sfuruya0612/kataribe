import CoreAudio
import Foundation

func address(
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
    var property = address(kAudioHardwarePropertyDevices)
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
    var property = address(selector)
    var value: CFString = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    guard AudioObjectGetPropertyData(id, &property, 0, nil, &size, &value) == noErr else {
        return ""
    }
    return value as String
}

func deviceName(_ id: AudioDeviceID) -> String {
    stringProperty(id, kAudioObjectPropertyName)
}

func deviceUID(_ id: AudioDeviceID) -> String {
    stringProperty(id, kAudioDevicePropertyDeviceUID)
}

func outputChannelCount(_ id: AudioDeviceID) -> Int {
    var property = address(kAudioDevicePropertyStreamConfiguration, scope: kAudioObjectPropertyScopeOutput)
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

func findDevice(nameContains needle: String) -> AudioDeviceID? {
    allDevices().first { deviceName($0).localizedCaseInsensitiveContains(needle) }
}

func findOutputDevice(nameContains needle: String) -> AudioDeviceID? {
    allDevices().first {
        deviceName($0).localizedCaseInsensitiveContains(needle) && outputChannelCount($0) > 0
    }
}

func setDefaultDevice(_ selector: AudioObjectPropertySelector, id: AudioDeviceID) -> Bool {
    var property = address(selector)
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

func currentDefaultDevice() -> AudioDeviceID {
    var property = address(kAudioHardwarePropertyDefaultOutputDevice)
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

func createAggregate(outputName: String, blackHoleName: String) -> AudioDeviceID? {
    guard let output = findOutputDevice(nameContains: outputName) else {
        fputs("output device not found: \(outputName)\n", stderr)
        return nil
    }
    guard let blackHole = findDevice(nameContains: blackHoleName) else {
        fputs("BlackHole device not found: \(blackHoleName)\n", stderr)
        return nil
    }

    let outputUID = deviceUID(output)
    let blackHoleUID = deviceUID(blackHole)
    guard !outputUID.isEmpty, !blackHoleUID.isEmpty else {
        fputs("device UID is empty\n", stderr)
        return nil
    }

    let description: [String: Any] = [
        kAudioAggregateDeviceNameKey as String: "Kataribe Multi-Output",
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

    for _ in 0..<10 {
        let current = currentDefaultDevice()
        if current != 0 && current != aggregateID {
            return current
        }
        if let actual = findDevice(nameContains: "Kataribe Multi-Output") {
            return actual
        }
        Thread.sleep(forTimeInterval: 0.2)
    }
    return aggregateID
}

@main
struct Main {
    static func main() {
        let arguments = CommandLine.arguments
        let command = arguments.count > 1 ? arguments[1] : "list"

        switch command {
        case "list":
            for id in allDevices() {
                print("\(id)\t\(deviceName(id))\t\(deviceUID(id))")
            }
        case "current":
            let id = currentDefaultDevice()
            print("\(id)\t\(deviceName(id))")
        case "create":
            let outputName = arguments.count > 2 ? arguments[2] : "MacBook Pro"
            let blackHoleName = arguments.count > 3 ? arguments[3] : "BlackHole 2ch"
            guard createAggregate(
                outputName: outputName,
                blackHoleName: blackHoleName
            ) != nil else {
                exit(1)
            }
            print("created=1")
        case "destroy":
            guard arguments.count > 2, let aggregateID = UInt32(arguments[2]) else {
                fputs("usage: multi-output destroy <id>\n", stderr)
                exit(2)
            }
            let status = AudioHardwareDestroyAggregateDevice(aggregateID)
            print("destroy status=\(status)")
        case "destroy-name":
            guard arguments.count > 2 else {
                fputs("usage: multi-output destroy-name <name>\n", stderr)
                exit(2)
            }
            let name = arguments[2]
            var destroyed = 0
            for id in allDevices() where deviceName(id).localizedCaseInsensitiveContains(name) {
                let status = AudioHardwareDestroyAggregateDevice(id)
                print("destroy id=\(id) name=\(deviceName(id)) status=\(status)")
                destroyed += 1
            }
            print("destroyed=\(destroyed)")
        default:
            fputs("usage: multi-output list|current|create <output-name> <blackhole-name>|destroy <id>|destroy-name <name>\n", stderr)
            exit(2)
        }
    }
}
