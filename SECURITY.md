# Credentials and reporting / 凭据与反馈

Do not commit AutoDL authorization tokens, SSH passwords, auth.txt, environment files, job states or logs. Each user stores credentials locally in an independent job directory; the repository contains only synthetic test fixtures. If a token is exposed, rotate it in the service and remove it from published history.

For a bug report, include the version, OS, Node version and a minimal redacted configuration/error. Do not include full API responses: they may contain SSH credentials. Do not put sensitive reports in public issues; use GitHub private vulnerability reporting if the repository exposes that option. Report suspected credential exposure without pasting the credential.

不要提交账号令牌、SSH密码、auth.txt、环境文件、任务状态或日志。反馈只包含版本、系统、Node版本和脱敏后的最小配置/错误；完整接口响应可能含密码。若发生泄露，应在服务端撤销或更新凭据，并处理已发布历史。敏感问题不要发到公开Issue；仓库提供GitHub私密漏洞报告入口时优先使用。
