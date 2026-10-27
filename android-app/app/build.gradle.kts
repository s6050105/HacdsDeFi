import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.hacds.defi"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.hacds.defi"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        // 只保留 arm64-v8a（D-A4）：正式分发。模拟器为 x86_64，构建时通过 -Pabi=x86_64 覆盖。
        ndk {
            abiFilters += listOf("arm64-v8a")
        }
    }

    // 允许命令行覆盖 ABI（本机模拟器为 x86_64，仅用于开发测试）
    if (project.hasProperty("abi")) {
        defaultConfig.ndk.abiFilters.clear()
        defaultConfig.ndk.abiFilters.add(project.property("abi") as String)
    }

    signingConfigs {
        // 发布签名（D-A6：APK 直接分发）。口令来源优先级：
        //   1) 仓库外/未入库的 keystore.properties（推荐）
        //   2) 环境变量 HACDS_KS_PASS / HACDS_KEY_ALIAS
        // 仓库内**不含**任何口令。见 tools/gen_keystore.py 与 README。
        val ksPropsFile = rootProject.file("keystore.properties")
        val props = Properties()
        if (ksPropsFile.exists()) FileInputStream(ksPropsFile).use { props.load(it) }
        val ksPass: String? = props.getProperty("storePassword") ?: System.getenv("HACDS_KS_PASS")
        val ksAlias: String = props.getProperty("keyAlias") ?: System.getenv("HACDS_KEY_ALIAS") ?: "hacds"

        create("release") {
            storeFile = rootProject.file("keystore/hacds-release.jks")
            storePassword = ksPass
            keyAlias = ksAlias
            keyPassword = ksPass
            // 同时启用 v1/v2/v3：v1 兼容 Android 7 等老设备，v2/v3 更安全
            enableV1Signing = true
            enableV2Signing = true
            enableV3Signing = true
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.09.03")
    implementation(composeBom)

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.navigation:navigation-compose:2.8.4")

    // 网络：节点 / 预言机 / 索引器 HTTP
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // 二维码（分片方案，D-A3）：生成用 zxing core，扫描用 zxing-android-embedded
    implementation("com.google.zxing:core:3.5.3")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")

    implementation("androidx.fragment:fragment-ktx:1.8.5")

    // 生物识别（可选解锁，D-A5/D-A12）
    implementation("androidx.biometric:biometric:1.1.0")

    // 注：曾引入 androidx.security:security-crypto（alpha）作为 EncryptedSharedPreferences 兼容层，
    // 但代码实际未使用（钱包加密由 Keystore.kt 自实现 scrypt+AES-GCM）。2026-10-22 审计移除该未用依赖。

    debugImplementation("androidx.compose.ui:ui-tooling")

    // 纯算法单测（Sha3 / Scrypt / DiamondScore / Fee / Units）——与 PC 端向量交叉验证
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
