// swift-tools-version: 6.0
// Доменное ядро ROAD TRACKER: чистый Swift + Foundation, без UIKit/CoreLocation.
// Собирается и тестируется на macOS и Linux (`swift test`), подключается к iOS-приложению.
import PackageDescription

let package = Package(
    name: "RoadTrackerCore",
    defaultLocalization: "ru",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "RoadTrackerCore", targets: ["RoadTrackerCore"])
    ],
    targets: [
        .target(
            name: "RoadTrackerCore",
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
        .testTarget(
            name: "RoadTrackerCoreTests",
            dependencies: ["RoadTrackerCore"],
            swiftSettings: [.swiftLanguageMode(.v6)]
        )
    ]
)
