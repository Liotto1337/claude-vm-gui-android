package io.github.liotto1337.claudevm.ssh

/** Порядок входа: ключ → пароль → keyboard-interactive; методы, которых сервер не предлагает (offered), не пробуются. */
object AuthPlan {
    fun build(offered: List<String>?, hasKey: Boolean, hasPassword: Boolean): List<String> {
        val all = buildList {
            if (hasKey) add("publickey")
            if (hasPassword) { add("password"); add("keyboard-interactive") }
        }
        return if (offered == null) all else all.filter { it in offered }
    }
}
