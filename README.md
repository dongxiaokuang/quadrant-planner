# Quadrant Planner

Organize tasks by importance and urgency in Obsidian. This desktop plugin provides a four-quadrant board, tags, completed-task history, and optional desktop reminders. **The current user interface is in Simplified Chinese.**

> Release preparation: this repository is being prepared for review. It has not been submitted to or approved for the Obsidian Community Plugins directory.

## Features

- Create tasks in four quadrants, edit and reorder them, mark them complete, and restore completed tasks.
- Add multiple reusable tags; manage tags and their names in settings. Completed tasks from the past 30 days are shown by default, with an option to view all history.
- Optionally set a deadline and one reminder rule: a single advance reminder, a daily reminder, or a weekly reminder before the deadline.
- Open the board from the ribbon or command palette, or embed the shared board in a Markdown note using:

````markdown
```quadrant-planner
```
````

Embedded boards and the standalone view share the same task list within the current vault; they do not create independent lists per note. The plugin does not write tasks into the note or automatically read Markdown task lists. The board is available in Reading view and can render in Live Preview. **When the cursor enters the fenced code block in Live Preview, Obsidian may show its source instead of the board; move the cursor to existing text outside the block to display it.** Source mode displays the code block as text.

## Install manually

1. Copy `main.js`, `manifest.json`, and `styles.css` into a `quadrant-planner-local` folder under your vault's plugin directory. By default this is `<vault>/.obsidian/plugins/quadrant-planner-local/`.
2. In Obsidian, enable third-party plugins and enable **Quadrant Planner**.
3. Open the board using its ribbon icon or the **打开四象限日程** command. Use **快速新建四象限事项** to create a task quickly; its default shortcut is Ctrl+Alt+N and can be changed in Obsidian's hotkey settings.

When updating, replace the three plugin files and keep the existing `data.json`; it contains your tasks and settings.

## Reminders and platform status

Obsidian must be running, the computer must be awake, and operating-system notifications must be permitted. Notification permission inside the app does not prove that Windows will display a notification: use **设置 → 测试提醒** in the board and check Windows notification settings. Checks run approximately every 30 seconds; timely delivery is not guaranteed during sleep or after Obsidian exits. When the app resumes before the deadline, at most the latest missed recurring reminder is issued; no new deadline-based reminder is sent after its deadline. Legacy absolute-time reminders keep their existing behavior.

The plugin is desktop-only. Development and limited testing have focused on Windows. A Windows system configuration can suppress notifications even when app-level permission is granted; actual delivery must be checked on the user's system. macOS and Linux have not been verified. Mobile is not supported in this version.

## Data and privacy

Tasks, labels and settings are stored locally in the plugin's `data.json` within the vault's configuration directory. They are not saved as Markdown tasks. This plugin does not implement its own sync service; if a vault is synchronized, verify that the plugin data file is included. Avoid editing the same plugin data on multiple devices simultaneously; synchronization conflicts are not automatically resolved. Back up your vault and plugin data using your chosen backup method. No account or network service is required by the current plugin.

## Development and checks

The project uses Node.js for its dependency-free local build. From this directory run:

```sh
node build.js
node logic.test.js
node labels.test.js
node iteration.test.js
node recent.test.js
node storage.test.js
node reminder.test.js
node embed.test.js
```

Run `reminder-dst.test.js` with the `TZ` environment variable set to `America/New_York` to exercise daylight-saving boundaries. `build.js` generates `main.js` from `logic.js` and `plugin-source.js`; `styles.css` and `manifest.json` are installed alongside it. Tests are not a substitute for checking notification delivery and interactions in an actual Obsidian installation.

## 中文简介

四象限日程是一款桌面端 Obsidian 待办插件，当前界面为简体中文。它支持按重要、紧急程度管理事项，设置标签、完成期限和到期前提醒，并可在笔记中嵌入共享看板。事项保存在当前知识库的插件数据文件中。提醒需要 Obsidian 运行、电脑处于工作状态且系统允许通知；Windows 通知请通过插件设置中的“测试提醒”验证。macOS 和 Linux 尚未验证。

## License

MIT License. See [LICENSE](LICENSE).
