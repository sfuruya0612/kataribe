import CoreAudio
import Foundation

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
    var address = propertyAddress(kAudioHardwarePropertyDevices)
    var size: UInt32 = 0
    let system = AudioObjectID(kAudioObjectSystemObject)
    guard AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size) == noErr else {
        return []
    }
    let count = Int(size) / MemoryLayout<AudioDeviceID>.size
    var ids = [AudioDeviceID](repeating: 0, count: count)
    guard AudioObjectGetPropertyData(system, &address, 0, nil, &size, &ids) == noErr else {
        return []
    }
    return ids
}

func deviceName(_ id: AudioDeviceID) -> String {
    var address = propertyAddress(kAudioObjectPropertyName)
    var name: CFString = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, &name) == noErr else {
        return "unknown"
    }
    return name as String
}

func channelCount(_ id: AudioDeviceID, scope: AudioObjectPropertyScope) -> Int {
    var address = propertyAddress(kAudioDevicePropertyStreamConfiguration, scope: scope)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(id, &address, 0, nil, &size) == noErr, size > 0 else {
        return 0
    }
    let raw = UnsafeMutableRawPointer.allocate(
        byteCount: Int(size),
        alignment: MemoryLayout<AudioBufferList>.alignment
    )
    defer { raw.deallocate() }
    guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, raw) == noErr else {
        return 0
    }
    let list = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
    return list.reduce(0) { $0 + Int($1.mNumberChannels) }
}

func defaultDevice(_ selector: AudioObjectPropertySelector) -> AudioDeviceID {
    var address = propertyAddress(selector)
    var id = AudioDeviceID(0)
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject),
        &address,
        0,
        nil,
        &size,
        &id
    )
    return id
}

func setDefaultDevice(_ selector: AudioObjectPropertySelector, id: AudioDeviceID) -> Bool {
    var address = propertyAddress(selector)
    var value = id
    let status = AudioObjectSetPropertyData(
        AudioObjectID(kAudioObjectSystemObject),
        &address,
        0,
        nil,
        UInt32(MemoryLayout<AudioDeviceID>.size),
        &value
    )
    return status == noErr
}

func printDevices() {
    for id in allDevices() {
        let output = channelCount(id, scope: kAudioObjectPropertyScopeOutput)
        let input = channelCount(id, scope: kAudioObjectPropertyScopeInput)
        print("\(id)\t\(deviceName(id))\tinput=\(input)\toutput=\(output)")
    }
}

@main
struct Main {
    static func main() {
        let arguments = CommandLine.arguments
        let command = arguments.count > 1 ? arguments[1] : "list"

        switch command {
        case "list":
            printDevices()
        case "current":
            let output = defaultDevice(kAudioHardwarePropertyDefaultOutputDevice)
            let system = defaultDevice(kAudioHardwarePropertyDefaultSystemOutputDevice)
            let input = defaultDevice(kAudioHardwarePropertyDefaultInputDevice)
            print("defaultOutput=\(output)\t\(deviceName(output))")
            print("defaultSystemOutput=\(system)\t\(deviceName(system))")
            print("defaultInput=\(input)\t\(deviceName(input))")
        case "set-output":
            guard arguments.count > 2 else {
                fputs("usage: audio-device set-output <name>\n", stderr)
                exit(2)
            }
            let name = arguments[2]
            guard let device = allDevices().first(where: {
                deviceName($0) == name && channelCount($0, scope: kAudioObjectPropertyScopeOutput) > 0
            }) else {
                fputs("device not found: \(name)\n", stderr)
                exit(3)
            }
            let a = setDefaultDevice(kAudioHardwarePropertyDefaultOutputDevice, id: device)
            let b = setDefaultDevice(kAudioHardwarePropertyDefaultSystemOutputDevice, id: device)
            print("set-output id=\(device) name=\(name) output=\(a) system=\(b)")
        case "set-output-id":
            guard arguments.count > 2, let id = UInt32(arguments[2]) else {
                fputs("usage: audio-device set-output-id <id>\n", stderr)
                exit(2)
            }
            let a = setDefaultDevice(kAudioHardwarePropertyDefaultOutputDevice, id: id)
            let b = setDefaultDevice(kAudioHardwarePropertyDefaultSystemOutputDevice, id: id)
            print("set-output-id id=\(id) name=\(deviceName(id)) output=\(a) system=\(b)")
        case "set-input":
            guard arguments.count > 2 else {
                fputs("usage: audio-device set-input <name>\n", stderr)
                exit(2)
            }
            let name = arguments[2]
            guard let device = allDevices().first(where: {
                deviceName($0) == name && channelCount($0, scope: kAudioObjectPropertyScopeInput) > 0
            }) else {
                fputs("input device not found: \(name)\n", stderr)
                exit(3)
            }
            let result = setDefaultDevice(kAudioHardwarePropertyDefaultInputDevice, id: device)
            print("set-input id=\(device) name=\(name) result=\(result)")
        case "set-input-id":
            guard arguments.count > 2, let id = UInt32(arguments[2]) else {
                fputs("usage: audio-device set-input-id <id>\n", stderr)
                exit(2)
            }
            let result = setDefaultDevice(kAudioHardwarePropertyDefaultInputDevice, id: id)
            print("set-input-id id=\(id) name=\(deviceName(id)) result=\(result)")
        default:
            fputs("usage: audio-device list|current|set-output <name>|set-output-id <id>|set-input <name>|set-input-id <id>\n", stderr)
            exit(2)
        }
    }
}
