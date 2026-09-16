// Run on macOS: swift scripts/generate-icons.swift
// Matches the sidebar brand: Georgia Italic, #c4d5b0 on #17191b.
import AppKit
import CoreText

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let build = root.appendingPathComponent("build")
let iconset = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".iconset")
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: iconset) }
let font = CTFontCreateWithName("Georgia-Italic" as CFString, 864, nil)
var character: UniChar = 114
var glyph: CGGlyph = 0
precondition(CTFontGetGlyphsForCharacters(font, &character, &glyph, 1))
let letter = CTFontCreatePathForGlyph(font, glyph, nil)!
let bounds = letter.boundingBoxOfPath
let offset = CGAffineTransform(translationX: 512 - bounds.midX, y: 512 - bounds.midY)
var transform = offset
let centeredLetter = letter.copy(using: &transform)!

func png(_ size: Int) throws -> Data {
    let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
                            bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.scaleBy(x: CGFloat(size) / 1024, y: CGFloat(size) / 1024)
    context.setFillColor(CGColor(red: 196/255, green: 213/255, blue: 176/255, alpha: 1))
    context.addPath(CGPath(roundedRect: CGRect(x: 64, y: 64, width: 896, height: 896),
                           cornerWidth: 236, cornerHeight: 236, transform: nil))
    context.fillPath()
    context.setFillColor(CGColor(red: 23/255, green: 25/255, blue: 27/255, alpha: 1))
    context.addPath(centeredLetter)
    context.fillPath()
    return NSBitmapImageRep(cgImage: context.makeImage()!).representation(using: .png, properties: [:])!
}
try png(1024).write(to: build.appendingPathComponent("icon.png"))
for size in [16, 32, 128, 256, 512] {
    try png(size).write(to: iconset.appendingPathComponent("icon_\(size)x\(size).png"))
    try png(size * 2).write(to: iconset.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
let process = Process()
process.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
process.arguments = ["-c", "icns", iconset.path, "-o", build.appendingPathComponent("icon.icns").path]
try process.run()
process.waitUntilExit()
precondition(process.terminationStatus == 0, "iconutil failed")
print("Generated build/icon.png and build/icon.icns")
