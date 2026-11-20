import Foundation
import CommonCrypto
import CryptoKit
import CoreImage
import UIKit

/// 网易云音乐加解密工具（与 Android NeteaseCrypto.kt / netease-cloud-music-api-alger 保持 100% 字节级一致）
enum NeteaseCrypto {
    private static let iv = "0102030405060708"
    private static let presetKey = "0CoJUm6Qyw8W8jud"
    private static let linuxApiKey = "rFgB&h#%2?^eDg:Q"
    private static let eapiKey = "e82ckenh8dichen8"
    private static let idXorKey = Array("3go8&$8*3*3h0k(2)2".utf8)
    private static let base62 = Array("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    private static let rsaModulusHex =
        "e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b72515" +
        "2b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ec" +
        "bda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d8" +
        "13cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7"

    private static let rsaModulusWords: [UInt32] = hexToWords(rsaModulusHex)

    static func aesEncryptCbcBase64(_ text: String, key: String, iv ivStr: String = iv) -> String {
        guard let data = text.data(using: .utf8),
              let keyData = key.data(using: .utf8),
              let ivData = ivStr.data(using: .utf8),
              let encrypted = aesCrypt(data: data, key: keyData, iv: ivData, operation: CCOperation(kCCEncrypt), options: CCOptions(kCCOptionPKCS7Padding))
        else { return "" }
        return encrypted.base64EncodedString()
    }

    static func aesEncryptEcbHex(_ text: String, key: String) -> String {
        guard let data = text.data(using: .utf8),
              let keyData = key.data(using: .utf8),
              let encrypted = aesCrypt(data: data, key: keyData, iv: nil, operation: CCOperation(kCCEncrypt), options: CCOptions(kCCOptionPKCS7Padding | kCCOptionECBMode))
        else { return "" }
        return bytesToHex(encrypted).uppercased()
    }

    private static func aesCrypt(
        data: Data,
        key: Data,
        iv: Data?,
        operation: CCOperation,
        options: CCOptions
    ) -> Data? {
        let outLength = data.count + kCCBlockSizeAES128
        var outBytes = [UInt8](repeating: 0, count: outLength)
        var numBytesEncrypted: size_t = 0

        let status: CCCryptorStatus = data.withUnsafeBytes { dataPtr in
            key.withUnsafeBytes { keyPtr in
                if let iv = iv {
                    return iv.withUnsafeBytes { ivPtr in
                        CCCrypt(
                            operation,
                            CCAlgorithm(kCCAlgorithmAES),
                            options,
                            keyPtr.baseAddress,
                            key.count,
                            ivPtr.baseAddress,
                            dataPtr.baseAddress,
                            data.count,
                            &outBytes,
                            outLength,
                            &numBytesEncrypted
                        )
                    }
                } else {
                    return CCCrypt(
                        operation,
                        CCAlgorithm(kCCAlgorithmAES),
                        options,
                        keyPtr.baseAddress,
                        key.count,
                        nil,
                        dataPtr.baseAddress,
                        data.count,
                        &outBytes,
                        outLength,
                        &numBytesEncrypted
                    )
                }
            }
        }
        guard status == kCCSuccess else { return nil }
        return Data(bytes: outBytes, count: numBytesEncrypted)
    }

    /// 纯 Swift 1024-bit RSA 无填充公钥加密 (e = 65537 = 2^16 + 1)
    static func rsaEncryptNoPaddingHex(_ text: String) -> String {
        let rawBytes = Array(text.utf8)
        let x = bytesToWords(rawBytes)
        let mod = rsaModulusWords
        var acc = x
        for _ in 0..<16 {
            acc = mulMod(acc, acc, mod)
        }
        acc = mulMod(acc, x, mod)
        return wordsToHex(acc)
    }

    static func weapi(_ jsonText: String) -> [String: String] {
        var chars = [Character]()
        chars.reserveCapacity(16)
        for _ in 0..<16 {
            let idx = Int.random(in: 0..<base62.count)
            chars.append(base62[idx])
        }
        let secretKey = String(chars)
        let firstPass = aesEncryptCbcBase64(jsonText, key: presetKey, iv: iv)
        let params = aesEncryptCbcBase64(firstPass, key: secretKey, iv: iv)
        let encSecKey = rsaEncryptNoPaddingHex(String(secretKey.reversed()))
        return ["params": params, "encSecKey": encSecKey]
    }

    static func linuxapi(_ jsonText: String) -> [String: String] {
        return ["eparams": aesEncryptEcbHex(jsonText, key: linuxApiKey)]
    }

    static func eapi(url: String, jsonText: String) -> [String: String] {
        let message = "nobody\(url)use\(jsonText)md5forencrypt"
        let digest = md5Hex(message)
        let data = "\(url)-36cd479b6b5-\(jsonText)-36cd479b6b5-\(digest)"
        return ["params": aesEncryptEcbHex(data, key: eapiKey)]
    }

    static func md5Bytes(_ data: Data) -> Data {
        let digest = Insecure.MD5.hash(data: data)
        return Data(digest)
    }

    static func md5Hex(_ text: String) -> String {
        return bytesToHex(md5Bytes(Data(text.utf8)))
    }

    static func cloudmusicDllEncodeId(_ deviceId: String) -> String {
        let devBytes = Array(deviceId.utf8)
        var xored = [UInt8](repeating: 0, count: devBytes.count)
        for i in 0..<devBytes.count {
            xored[i] = devBytes[i] ^ idXorKey[i % idXorKey.count]
        }
        return md5Bytes(Data(xored)).base64EncodedString()
    }

    static func encodeAnonymousUsername(_ deviceId: String) -> String {
        let combined = "\(deviceId) \(cloudmusicDllEncodeId(deviceId))"
        return Data(combined.utf8).base64EncodedString()
    }

    static func generateDeviceId() -> String {
        let hexChars = Array("0123456789ABCDEF")
        var out = ""
        out.reserveCapacity(52)
        for _ in 0..<52 {
            out.append(hexChars[Int.random(in: 0..<hexChars.count)])
        }
        return out
    }

    static func randomHex(byteCount: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        for i in 0..<byteCount {
            bytes[i] = UInt8.random(in: 0...255)
        }
        return bytesToHex(Data(bytes))
    }

    static func bytesToHex(_ data: Data) -> String {
        return data.map { String(format: "%02x", $0) }.joined()
    }

    /// 使用系统 CoreImage 生成可扫描 PNG 二维码 Data URL（支持网易云扫码登录）
    static func generateQrPngDataUrl(_ content: String, size: CGFloat = 280) -> String {
        guard let data = content.data(using: .utf8),
              let filter = CIFilter(name: "CIQRCodeGenerator") else { return "" }
        filter.setValue(data, forKey: "inputMessage")
        filter.setValue("M", forKey: "inputCorrectionLevel")
        guard let ciImage = filter.outputImage else { return "" }
        let scaleX = size / ciImage.extent.size.width
        let scaleY = size / ciImage.extent.size.height
        let transformed = ciImage.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))
        let context = CIContext()
        guard let cgImage = context.createCGImage(transformed, from: transformed.extent) else { return "" }
        let uiImage = UIImage(cgImage: cgImage)
        guard let pngData = uiImage.pngData() else { return "" }
        return "data:image/png;base64,\(pngData.base64EncodedString())"
    }

    // MARK: - 1024-bit Unsigned BigInt Helpers (32 x UInt32 little-endian limbs)

    private static func hexToWords(_ hex: String) -> [UInt32] {
        let padded = String(repeating: "0", count: max(0, 256 - hex.count)) + hex
        var bytes = [UInt8]()
        bytes.reserveCapacity(128)
        var idx = padded.startIndex
        for _ in 0..<128 {
            let next = padded.index(idx, offsetBy: 2)
            let b = UInt8(padded[idx..<next], radix: 16) ?? 0
            bytes.append(b)
            idx = next
        }
        return bytesToWords(bytes)
    }

    private static func bytesToWords(_ raw: [UInt8]) -> [UInt32] {
        var buf = [UInt8](repeating: 0, count: 128)
        let copyLen = min(raw.count, 128)
        let start = 128 - copyLen
        for i in 0..<copyLen {
            buf[start + i] = raw[raw.count - copyLen + i]
        }
        var words = [UInt32](repeating: 0, count: 32)
        for i in 0..<32 {
            let off = i * 4
            let w = (UInt32(buf[off]) << 24) | (UInt32(buf[off + 1]) << 16) | (UInt32(buf[off + 2]) << 8) | UInt32(buf[off + 3])
            words[31 - i] = w
        }
        return words
    }

    private static func wordsToHex(_ words: [UInt32]) -> String {
        var out = ""
        out.reserveCapacity(256)
        for i in stride(from: 31, through: 0, by: -1) {
            out += String(format: "%08x", words[i])
        }
        return out
    }

    private static func gte(_ a: [UInt32], _ b: [UInt32]) -> Bool {
        let n = max(a.count, b.count)
        for i in stride(from: n - 1, through: 0, by: -1) {
            let ai = i < a.count ? a[i] : 0
            let bi = i < b.count ? b[i] : 0
            if ai != bi { return ai > bi }
        }
        return true
    }

    private static func subInPlace(_ a: inout [UInt32], _ b: [UInt32]) {
        var borrow: Int64 = 0
        for i in 0..<a.count {
            let ai = Int64(a[i])
            let bi = Int64(i < b.count ? b[i] : 0)
            let diff = ai - bi - borrow
            if diff < 0 {
                a[i] = UInt32(diff + 0x1_0000_0000)
                borrow = 1
            } else {
                a[i] = UInt32(diff)
                borrow = 0
            }
        }
    }

    private static func mulMod(_ a: [UInt32], _ b: [UInt32], _ mod: [UInt32]) -> [UInt32] {
        var prod = [UInt32](repeating: 0, count: 64)
        for i in 0..<32 {
            var carry: UInt64 = 0
            let ai = UInt64(a[i])
            for j in 0..<32 {
                let sum = UInt64(prod[i + j]) + ai * UInt64(b[j]) + carry
                prod[i + j] = UInt32(sum & 0xFFFF_FFFF)
                carry = sum >> 32
            }
            prod[i + 32] = UInt32(carry)
        }

        var rem = [UInt32](repeating: 0, count: 33)
        var mod33 = mod
        mod33.append(0)

        for bit in stride(from: 2047, through: 0, by: -1) {
            var carryBit: UInt32 = (prod[bit >> 5] >> UInt32(bit & 31)) & 1
            for i in 0..<33 {
                let nextCarry = (rem[i] >> 31) & 1
                rem[i] = (rem[i] << 1) | carryBit
                carryBit = nextCarry
            }
            if gte(rem, mod33) {
                subInPlace(&rem, mod33)
            }
        }
        return Array(rem[0..<32])
    }
}
