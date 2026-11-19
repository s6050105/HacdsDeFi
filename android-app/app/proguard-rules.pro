# ============================================================================
# R8 混淆规则（2026-11-15 审计 M-8 / A-51）
#
# 原则：只保留**反射/JNI 真正需要**的类，其余全部混淆 + 收缩。
# 隐私收益：混淆后逆向难度大幅上升，字符串与类名不再直接暴露交易逻辑。
# ============================================================================

# ---- JNI 引擎（R8 不能改名或删除 native 方法）----
-keep class com.hacds.defi.TxEngine { *; }
-keepclasseswithmembernames class * { native <methods>; }

# ---- JSON 序列化：字段名参与 wire 格式，不能混淆 ----
-keepclassmembers class com.hacds.defi.core.AppConfig { <fields>; }
-keepclassmembers class com.hacds.defi.wallet.WalletStore$WalletInfo { <fields>; }

# ---- Kotlin 协程 / Compose 运行时所需的元数据 ----
-keepattributes *Annotation*, InnerClasses, Signature, Exceptions
-dontwarn kotlinx.coroutines.**
-dontwarn org.jetbrains.annotations.**

# ---- Compose ----
-dontwarn androidx.compose.**

# ---- OkHttp / Okio（内部有反射）----
-dontwarn okhttp3.**
-dontwarn okio.**
-keepclassmembers class okhttp3.** { *; }

# ---- 保留行号，便于崩溃定位（不保留源文件名）----
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
