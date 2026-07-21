// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "RC5Kit",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "RC5Kit", targets: ["RC5Kit"])
    ],
    targets: [
        .target(name: "RC5Kit"),
        .testTarget(name: "RC5KitTests", dependencies: ["RC5Kit"]),
    ]
)
