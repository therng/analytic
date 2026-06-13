// swift-tools-version: 6.0
// NOTE: This Package.swift is for reference/CLI builds only.
// The iOS app target (ios/Analytic.xcodeproj) is the primary build path.
// To create the Xcode project, see ios/README.md.

import PackageDescription

let package = Package(
    name: "Analytic",
    platforms: [
        .iOS("26.0")
    ],
    products: [
        .library(name: "Analytic", targets: ["Analytic"])
    ],
    targets: [
        .target(
            name: "Analytic",
            path: "Analytic",
            swiftSettings: [
                .enableExperimentalFeature("StrictConcurrency")
            ]
        )
    ]
)
