import AppKit
import SwiftUI
import Carbon.HIToolbox

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var panel: NSPanel!
    private var hotKeyRef: EventHotKeyRef?
    private let model = SessionModel()

    func applicationDidFinishLaunching(_ notification: Notification) {
        setUpStatusItem()
        setUpPanel()
        registerHotKey()
    }

    // MARK: 選單列圖示

    private func setUpStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = NSImage(
            systemSymbolName: "text.bubble",
            accessibilityDescription: "English Coach"
        )

        let menu = NSMenu()
        let open = NSMenuItem(title: "開始練習（⌃⌥E）", action: #selector(showPanel), keyEquivalent: "")
        open.target = self
        menu.addItem(open)
        let folder = NSMenuItem(title: "打開紀錄資料夾", action: #selector(openFolder), keyEquivalent: "")
        folder.target = self
        menu.addItem(folder)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "結束", action: #selector(quitApp), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        statusItem.menu = menu
    }

    // MARK: 浮動視窗

    private func setUpPanel() {
        panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 480, height: 500),
            styleMask: [.titled, .closable, .utilityWindow],
            backing: .buffered,
            defer: false
        )
        panel.title = "English Coach"
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.contentView = NSHostingView(
            rootView: CoachView(model: model, onClose: { [weak self] in self?.panel.orderOut(nil) })
        )
        panel.center()
    }

    @objc func showPanel() {
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
    }

    func togglePanel() {
        if panel.isVisible && NSApp.isActive {
            panel.orderOut(nil)
        } else {
            showPanel()
        }
    }

    @objc private func openFolder() {
        try? FileManager.default.createDirectory(at: Store.directory, withIntermediateDirectories: true)
        NSWorkspace.shared.open(Store.directory)
    }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }

    // MARK: 全域快捷鍵 ⌃⌥E（不需要額外權限）

    private func registerHotKey() {
        var spec = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        InstallEventHandler(
            GetApplicationEventTarget(),
            { _, _, userData in
                guard let userData = userData else { return noErr }
                let me = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()
                DispatchQueue.main.async { me.togglePanel() }
                return noErr
            },
            1,
            &spec,
            Unmanaged.passUnretained(self).toOpaque(),
            nil
        )
        let id = EventHotKeyID(signature: OSType(0x45434348), id: 1)
        RegisterEventHotKey(
            UInt32(kVK_ANSI_E),
            UInt32(controlKey | optionKey),
            id,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
    }
}
