# Changelog

## v0.1.4

- 连接上下文改为 `systemPrompt.context`（对话尾部的动态运行时快照），切换连接 / 编辑连接不再让该会话的上下文前缀缓存失效；
- 精简三个工具的 description，模型调用更稳。

## v0.1.3

- 连接保存后所有读取路径立即生效（`ensureLoaded` 返回实时快照，不再读到启动时的旧快照）；
- 写盘失败内存回滚，与磁盘保持一致；启动诊断日志增强。

## v0.1.2

- 修复设置页首次渲染崩溃（connections 为 null 时无条件 map）。

## v0.1.1

- 补全 Typert model 块（loader 强制校验，缺失会导致整个 typert-loader 行激活失败）；
- 输入栏按钮紧凑布局；设置页加载失败提示；Host 启动诊断日志（boot.log）。

## v0.1.0

- 首个发布：设置页连接管理（增删改 / 测试 / 表白名单 / 写权限）、会话级连接切换（输入栏 🐬 按钮）、全局 `mysql_query` / `mysql_tables` / `mysql_execute` 工具。