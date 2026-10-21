package io.github.liotto1337.claudevm.ssh

import java.io.File
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** known_hosts в формате OpenSSH (как src/shared/known-hosts.ts): простые, с портом и хешированные (|1|) записи. */
class HostKeys(private val file: File) {
    enum class Check { MATCH, UNKNOWN, MISMATCH }

    private fun entries(): List<Triple<String, String, ByteArray>> {
        val text = if (file.exists()) file.readText() else ""
        return text.lineSequence().map { it.trim() }
            .filter { it.isNotEmpty() && !it.startsWith("#") && !it.startsWith("@") }
            .mapNotNull { line ->
                val p = line.split(Regex("\\s+"))
                if (p.size < 3) null else runCatching { Triple(p[0], p[1], Base64.getDecoder().decode(p[2])) }.getOrNull()
            }.toList()
    }

    /** MISMATCH — у хоста записан другой ключ того же типа (возможна подмена сервера). */
    fun check(host: String, port: Int, type: String, key: ByteArray): Check {
        var mismatch = false
        for ((hosts, t, blob) in entries()) {
            if (t != type || !hostMatches(hosts, host, port)) continue
            if (blob.contentEquals(key)) return Check.MATCH
            mismatch = true
        }
        return if (mismatch) Check.MISMATCH else Check.UNKNOWN
    }

    fun knownTypes(host: String, port: Int): List<String> =
        entries().filter { hostMatches(it.first, host, port) }.map { it.second }.distinct()

    fun knownFingerprint(host: String, port: Int, type: String): String? =
        entries().firstOrNull { it.second == type && hostMatches(it.first, host, port) }?.let { fingerprint(it.third) }

    fun add(host: String, port: Int, type: String, key: ByteArray) {
        file.parentFile?.mkdirs()
        val prev = if (file.exists()) file.readText() else ""
        val prefix = if (prev.isEmpty() || prev.endsWith("\n")) "" else "\n"
        file.appendText("$prefix${pattern(host, port)} $type ${Base64.getEncoder().encodeToString(key)}\n")
    }

    companion object {
        private fun pattern(host: String, port: Int) = if (port == 22) host else "[$host]:$port"

        private fun hostMatches(field: String, host: String, port: Int): Boolean {
            val target = pattern(host, port)
            if (field.startsWith("|1|")) {
                val parts = field.split("|")
                if (parts.size < 4) return false
                return runCatching {
                    val mac = Mac.getInstance("HmacSHA1")
                    mac.init(SecretKeySpec(Base64.getDecoder().decode(parts[2]), "HmacSHA1"))
                    MessageDigest.isEqual(mac.doFinal(target.toByteArray()), Base64.getDecoder().decode(parts[3]))
                }.getOrDefault(false)
            }
            return field.split(",").contains(target)
        }

        /** Отпечаток как у OpenSSH: SHA256:<base64 без «=»>. */
        fun fingerprint(key: ByteArray): String =
            "SHA256:" + Base64.getEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(key))

        /** Тип ключа — первая строка внутри blob (uint32 длина + текст). */
        fun typeOf(key: ByteArray): String {
            val len = ByteBuffer.wrap(key, 0, 4).int
            return String(key, 4, len, Charsets.US_ASCII)
        }

        /** Алгоритмы ключа сервера для известных типов: ssh-rsa включает rsa-sha2-*. */
        fun algorithms(types: List<String>): List<String> =
            types.flatMap { if (it == "ssh-rsa") listOf("rsa-sha2-512", "rsa-sha2-256", "ssh-rsa") else listOf(it) }
    }
}
