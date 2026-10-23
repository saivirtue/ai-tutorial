// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "EnglishCoach",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "EnglishCoach", path: "Sources/EnglishCoach")
    ]
)
