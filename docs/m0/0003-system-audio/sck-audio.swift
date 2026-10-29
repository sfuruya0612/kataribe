import AVFoundation
import CoreGraphics
import CoreMedia
import Foundation
import ScreenCaptureKit

struct Result: Codable {
    var ok: Bool
    var peak: Double
    var rms: Double
    var samples: Int
    var nonZero: Int
    var buffers: Int
    var duration: Double
    var error: String?
}

final class AudioOutput: NSObject, SCStreamOutput {
    private let lock = NSLock()
    private var peak: Double = 0
    private var sumSquares: Double = 0
    private var sampleCount: Int = 0
    private var nonZero: Int = 0
    private var bufferCount: Int = 0
    private let startedAt = Date()

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .audio, sampleBuffer.isValid else { return }
        guard let formatDescription = sampleBuffer.formatDescription else { return }
        guard let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription)?.pointee else {
            return
        }
        guard asbd.mFormatID == kAudioFormatLinearPCM,
              (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0 else {
            return
        }

        let maximumBuffers = 8
        let listSize = MemoryLayout<AudioBufferList>.size
            + (maximumBuffers - 1) * MemoryLayout<AudioBuffer>.size
        let audioBufferList = AudioBufferList.allocate(maximumBuffers: maximumBuffers)
        defer { free(audioBufferList.unsafeMutablePointer) }

        var blockBuffer: CMBlockBuffer?
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: audioBufferList.unsafeMutablePointer,
            bufferListSize: listSize,
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: 0,
            blockBufferOut: &blockBuffer
        )
        guard status == noErr else { return }

        lock.lock()
        defer { lock.unlock() }

        bufferCount += 1
        for buffer in audioBufferList {
            guard let data = buffer.mData else { continue }
            let count = Int(buffer.mDataByteSize) / MemoryLayout<Float>.size
            let pointer = data.bindMemory(to: Float.self, capacity: count)
            for index in 0..<count {
                let value = Double(pointer[index])
                let absolute = abs(value)
                if absolute > peak { peak = absolute }
                if absolute > 0 { nonZero += 1 }
                sumSquares += value * value
                sampleCount += 1
            }
        }
    }

    func snapshot(error: String? = nil) -> Result {
        lock.lock()
        defer { lock.unlock() }
        let duration = Date().timeIntervalSince(startedAt)
        let rms = sampleCount > 0 ? sqrt(sumSquares / Double(sampleCount)) : 0
        return Result(
            ok: peak > 0,
            peak: peak,
            rms: rms,
            samples: sampleCount,
            nonZero: nonZero,
            buffers: bufferCount,
            duration: duration,
            error: error
        )
    }
}

@main
struct Main {
    static func main() async {
        let output = AudioOutput()

        do {
            let content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: true
            )
            guard let display = content.displays.first else {
                printResult(output.snapshot(error: "no display"))
                exit(2)
            }

            let filter = SCContentFilter(
                display: display,
                excludingApplications: [],
                exceptingWindows: []
            )
            let configuration = SCStreamConfiguration()
            configuration.width = 2
            configuration.height = 2
            configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
            configuration.capturesAudio = true
            configuration.excludesCurrentProcessAudio = true
            configuration.sampleRate = 48_000
            configuration.channelCount = 2

            let stream = SCStream(filter: filter, configuration: configuration, delegate: nil)
            try stream.addStreamOutput(
                output,
                type: .audio,
                sampleHandlerQueue: DispatchQueue(label: "kataribe.m0.audio")
            )

            print("screenCaptureAccess=\(CGPreflightScreenCaptureAccess())")
            try await stream.startCapture()
            try await Task.sleep(nanoseconds: 10_000_000_000)
            try await stream.stopCapture()
            printResult(output.snapshot())
        } catch {
            printResult(output.snapshot(error: String(describing: error)))
            exit(1)
        }
    }

    static func printResult(_ result: Result) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        if let data = try? encoder.encode(result),
           let text = String(data: data, encoding: .utf8) {
            print(text)
        }
    }
}
