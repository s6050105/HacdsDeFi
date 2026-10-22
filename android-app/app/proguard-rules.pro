# 保留 JNI 绑定类与外部方法（R8 不能改名/删除 native 方法）
-keep class com.hacds.defi.TxEngine { *; }
-keepclasseswithmembernames class * { native <methods>; }
