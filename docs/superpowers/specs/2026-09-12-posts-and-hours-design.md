# Approved posts and hours design

Skyler approved this scope in the task on September 12, 2026.

1. Web hours: service type selector including Other; zero default tour credits; decimal hours; local service date picker; only report success after confirmed persistence; expired-session and network errors preserve input. Test validation, authorization, saving, and mobile layout.
2. Admin scheduling in web and native mobile: publish now or future date/time; view, edit, reschedule, cancel pending posts. Notifications occur at publication only.
3. Admin poll creation on both platforms: question, 2–6 distinct options, optional closing time; one vote per participant (students and staff), changeable until closing; aggregate results and own choice only. Polls can be scheduled.
4. Application portal and account deactivation remain future work.

Architecture: keep scheduled content in a separate server-only table so existing post reads and notifications never expose drafts. A transactional database publisher inserts due posts and poll metadata together. A minute-level database cron invokes it. Poll votes remain private behind authenticated server endpoints; vote writes serialize against closing and validate membership. Existing plain posts remain compatible. Scheduled posts and poll creation use JSON and do not include attachments in this first version; ordinary posts retain attachments.

Stay on current branch without commits or pushes until authorized. Preserve unrelated files. Production migration and mobile release/deployment require their established release gates. Use a Release build for native validation.
