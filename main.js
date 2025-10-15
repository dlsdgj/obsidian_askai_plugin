const {
  Plugin,
  PluginSettingTab,
  Setting,
  MarkdownRenderer,
  Modal,
  Notice,
  MarkdownView,
} = require("obsidian");

module.exports = class AskAiPlugin extends Plugin {
  async onload() {
    console.log("Ask AI 插件已加载");

    await this.loadSettings();
    this.addSettingTab(new AskAiSettingTab(this.app, this));
    
    // 初始化鼠标位置跟踪变量
    this.lastMouseX = window.innerWidth / 2;
    this.lastMouseY = window.innerHeight / 2;
    
    // 初始化鼠标按下状态标记
    this.isMouseDown = false;
    
    // 添加全局鼠标移动监听器，记录最新的鼠标位置
    this.mousePositionListener = (e) => {
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    };
    document.addEventListener('mousemove', this.mousePositionListener);
    
    // 添加全局鼠标按下和释放事件监听器
    this.mouseDownListener = () => {
      this.isMouseDown = true;
    };
    this.mouseUpListener = () => {
      this.isMouseDown = false;
    };
    document.addEventListener('mousedown', this.mouseDownListener);
    document.addEventListener('mouseup', this.mouseUpListener);

    this.addCommand({
      id: "ask-ai",
      name: "Ask AI about selection",
      editorCallback: (editor) => {
        this.handleSelection(editor);
      },
      hotkeys: [] // 允许用户在Obsidian设置中自定义快捷键
    });

    // 改进的事件监听策略，确保在DOM变化后也能捕获文本选择
    const setupSelectionListener = () => {
      const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeLeaf?.editor) {
        const cm = 
          activeLeaf.editor.cm?.dom || activeLeaf.editor.cm?.display?.wrapper;
        if (cm) {
          // 移除可能已存在的监听器，避免重复绑定
          cm.removeEventListener("mouseup", handleEditorMouseUp);
          cm.addEventListener("mouseup", handleEditorMouseUp);
          
          // 添加selectionchange事件监听，捕获更细微的选择变化
          cm.removeEventListener("selectionchange", handleEditorSelectionChange);
          cm.addEventListener("selectionchange", handleEditorSelectionChange);
        }
      }
    };

    const handleEditorMouseUp = (evt) => {
      const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeLeaf?.editor) {
        const selection = activeLeaf.editor.getSelection();
        if (selection && selection.trim()) {
          // 保存释放鼠标时的确切位置，避免悬浮球跟随鼠标移动
          this.lastSelectionMouseX = evt.pageX;
          this.lastSelectionMouseY = evt.pageY;
          this.showFloatingButton(evt, selection, activeLeaf.editor);
        }
      }
    };

    // 监听selectionchange事件，但只有在鼠标未按下状态下才显示悬浮球
    const handleEditorSelectionChange = () => {
      // 检查鼠标是否处于按下状态
      if (this.isMouseDown) {
        return; // 鼠标按下状态，不显示悬浮球
      }
      
      const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeLeaf?.editor) {
        const selection = activeLeaf.editor.getSelection();
        // 检查当前是否已经有悬浮球显示，避免重复创建
        const existingButton = document.querySelector(".ask-ai-btn");
        
        if (selection && selection.trim()) {
          // 如果已有悬浮球存在且没有菜单显示，直接返回
          if (existingButton) {
            const existingMenu = document.querySelector(".ask-ai-menu");
            if (!existingMenu) {
              return;
            }
          }
          
          // 模拟一个事件对象用于showFloatingButton
          // 使用保存的选择时鼠标位置，而不是当前鼠标位置，避免悬浮球跟随鼠标移动
          const mockEvent = {
            pageX: this.lastSelectionMouseX || this.lastMouseX,
            pageY: this.lastSelectionMouseY || this.lastMouseY
          };
          
          // 避免频繁触发，增加防抖时间到200ms
          clearTimeout(this.selectionTimeout);
          this.selectionTimeout = setTimeout(() => {
            // 再次检查是否有悬浮球，确保在定时器触发前没有被创建
            const checkExistingButton = document.querySelector(".ask-ai-btn");
            if (!checkExistingButton || document.querySelector(".ask-ai-menu")) {
              this.showFloatingButton(mockEvent, selection, activeLeaf.editor);
            }
          }, 200);
        }
      }
    };

    // 在叶子节点切换时设置监听器
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", setupSelectionListener)
    );

    // 在编辑器内容更新后也设置监听器，确保新展开的HTML代码也能被监听
    this.registerEvent(
      this.app.workspace.on("layout-change", setupSelectionListener)
    );

    // 添加内容变化监听器，捕获HTML标签展开等DOM变化
    this.registerEvent(
      this.app.workspace.on("editor-change", setupSelectionListener)
    );

    // 为文档添加全局的selectionchange事件监听作为后备
    this.globalSelectionChangeListener = (e) => {
      // 检查鼠标是否处于按下状态
      if (this.isMouseDown) {
        return; // 鼠标按下状态，不显示悬浮球
      }
      
      const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeLeaf?.editor) {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed && selection.toString().trim()) {
          // 避免频繁触发
          clearTimeout(this.globalSelectionTimeout);
          this.globalSelectionTimeout = setTimeout(() => {
            // 检查选择是否在编辑器内
            const editorElement = activeLeaf.editor.cm?.dom || activeLeaf.editor.cm?.display?.wrapper;
            if (editorElement && editorElement.contains(selection.anchorNode)) {
              // 使用实际记录的鼠标位置，而不是固定的屏幕中央
              const mockEvent = {
                pageX: this.lastMouseX,
                pageY: this.lastMouseY
              };
              this.showFloatingButton(mockEvent, selection.toString(), activeLeaf.editor);
            }
          }, 100);
        }
      }
    };
    
    // 实际添加全局事件监听器
    document.addEventListener('selectionchange', this.globalSelectionChangeListener);

    // 初始设置监听器
    setupSelectionListener();

    // 自动化模式键盘事件监听器
    this.autoModeKeyboardListener = (e) => {
      // 检查是否按下了正确的修饰键和主要按键
      const altKey = e.altKey === this.settings.autoModeShortcutAlt;
      const ctrlKey = e.ctrlKey === this.settings.autoModeShortcutCtrl;
      const shiftKey = e.shiftKey === this.settings.autoModeShortcutShift;
      const metaKey = e.metaKey === this.settings.autoModeShortcutMeta;
      const key = e.key.toLowerCase() === this.settings.autoModeShortcutKey.toLowerCase();

      // 如果所有条件都满足
      if (altKey && ctrlKey && shiftKey && metaKey && key) {
        e.preventDefault();
        e.stopPropagation();

        // 获取当前编辑器
        const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeLeaf?.editor) {
          const editor = activeLeaf.editor;
          
          // 尝试获取选中文本
          let selectedText = editor.getSelection();
          
          // 如果没有获取到选中文本，尝试使用window.getSelection作为后备
          if (!selectedText) {
            const windowSelection = window.getSelection();
            if (windowSelection && !windowSelection.isCollapsed && windowSelection.toString().trim()) {
              selectedText = windowSelection.toString().trim();
            }
          }

          if (selectedText) {
            // 创建一个自动模式专用的模态框
            const autoModal = new AskModal(this.app, this, selectedText, editor);
            autoModal._autoMode = true; // 标记为自动模式
            autoModal.open();
            
            // 模拟自动发送请求
            setTimeout(() => {
              if (autoModal.inputField) {
                // 使用默认模板或第一个模板
                const apiIndex = autoModal.apiIndex ?? this.settings.defaultApiIndex ?? 0;
                const api = this.settings.apis[apiIndex];
                
                if (api) {
                  // 执行默认模板或者用户设置的模板
                  const promptTemplate = this.settings.promptTemplates[this.settings.defaultPromptIndex]?.template || '';
                  const prompt = promptTemplate.replace(/{{selection}}/g, selectedText);
                  
                  autoModal.inputField.value = prompt;
                  autoModal.continueBtn?.click();
                }
              }
            }, 100);
          } else {
            new Notice("没有选中文字");
          }
        }
      }
    };

    document.addEventListener('keydown', this.autoModeKeyboardListener);
  }

  onunload() {
    console.log("Ask AI 插件已卸载");
    
    // 清理全局事件监听器，避免内存泄漏
    document.removeEventListener('selectionchange', this.globalSelectionChangeListener);
    document.removeEventListener('keydown', this.autoModeKeyboardListener);
    document.removeEventListener('mousemove', this.mousePositionListener);
    document.removeEventListener('mousedown', this.mouseDownListener);
    document.removeEventListener('mouseup', this.mouseUpListener);
    
    // 清理定时器
    clearTimeout(this.selectionTimeout);
    clearTimeout(this.globalSelectionTimeout);
  }

  async loadSettings() {
    this.settings = Object.assign(
      {
        apis: [],
        defaultApiIndex: 0,
        // 移除旧版promptTemplate
        // 新增多个prompt模板支持
        promptTemplates: [
          { name: "默认翻译", template: `请根据selection，按如下要求执行：selection:\n{{selection}}\n\n要求：\n- 如果\"selection\"是英文单词则**仅翻译并给出其词源, 忽略其他要求**\n- 如果\"selection\"是一段英文，请分别给出直译和接地气的中文翻译,并解释其中关键词句；\n- 如果\"selection\"是中文段落，请通俗易懂地解释其含义；\n- 如有上下文，请结合上下文进行说明, \n**翻译仅限selection内容**。\n\n上下文：{{context}}` },
          { name: "英文翻译", template: `请翻译以下英文内容为中文：\n{{selection}}` },
          { name: "中文解释", template: `请用大白话解释以下内容：\n{{selection}}` }
        ],
        defaultPromptIndex: 0,
        defaultFontFamily: "",
        floatingButtonPinned: true, // 默认设为常显
        // 新增：悬浮球位置保存
        floatingButtonX: null,
        floatingButtonY: null,
        // 中键点击快捷键设置
        middleClickShortcutKey: "a",
        middleClickShortcutAlt: true,
        middleClickShortcutCtrl: false,
        middleClickShortcutShift: false,
        middleClickShortcutMeta: false,
        
        // 自定义快捷键设置
        customShortcutName: "自定义快捷键",
        customShortcutKey: "b",
        customShortcutAlt: false,
        customShortcutCtrl: true,
        customShortcutShift: false,
        customShortcutMeta: false,
        
        // 自定义文本设置
        customTextName: "自定义文本",
        customTextContent: ">![{{selection}}]\n",
        
        // 自动化模式设置
        autoModeShortcutKey: "a",
        autoModeShortcutAlt: true,
        autoModeShortcutCtrl: true,
        autoModeShortcutShift: true,
        autoModeShortcutMeta: false,
        autoModeScript: "// 自动化脚本示例\ninsertCustomText()\nclearFormat()\n// copy()\ncloseModal()"
      },
      await this.loadData()
    );
    
    // 清理不再需要的设置项
    if (this.settings.middleClickShortcut !== undefined) {
      delete this.settings.middleClickShortcut;
      await this.saveSettings();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  showFloatingButton(evt, selection, editor) {
  // 二级菜单悬停状态变量（提升作用域）
  let strikethroughSubMenuHovered = false;
  let subMenuHovered = false;
  
  // 检查是否已有悬浮球存在
  const existingButton = document.querySelector(".ask-ai-btn");
  let button;
  
  // 如果是正常状态且已有悬浮球，且当前没有菜单显示，直接返回
  // 这可以避免悬浮球被频繁创建和销毁导致的跳动
  if (existingButton && !this.settings.floatingButtonPinned) {
    const existingMenu = document.querySelector(".ask-ai-menu");
    if (!existingMenu) {
      return;
    }
  }
  
  // 无论是否是常显状态，先移除所有已存在的悬浮球
  // 这解决了当拖动常显悬浮球后出现两个悬浮球的问题
  const allExistingButtons = document.querySelectorAll(".ask-ai-btn");
  allExistingButtons.forEach(btn => btn.remove());
  
  // 如果是常显状态且之前有悬浮球存在，保持悬浮球位置不变，只更新点击事件逻辑
  let currentLeft = null;
  let currentTop = null;
  
  // 优先使用设置中保存的位置
  if (this.settings.floatingButtonPinned && this.settings.floatingButtonX !== null && this.settings.floatingButtonY !== null) {
    currentLeft = `${this.settings.floatingButtonX}px`;
    currentTop = `${this.settings.floatingButtonY}px`;
  }
  // 如果设置中没有保存位置，但有现存的悬浮球，使用其位置
  else if (existingButton && this.settings.floatingButtonPinned) {
    currentLeft = existingButton.style.left;
    currentTop = existingButton.style.top;
  }
  
  // 创建新的悬浮球
  button = document.createElement("button");
  button.textContent = "🤖";
  button.className = "ask-ai-btn";
  button.style.position = "absolute";
  
  // 如果是常显状态但没有保存的位置，则使用鼠标位置
  if (this.settings.floatingButtonPinned && !currentLeft) {
    // 这种情况可能出现在首次设置常显时
    button.style.left = `${evt.pageX + 10}px`;
    button.style.top = `${evt.pageY}px`;
  } else if (currentLeft) {
    // 使用保存的位置
    button.style.left = currentLeft;
    button.style.top = currentTop;
  } else {
    // 正常情况下使用鼠标位置
    // 添加小的随机偏移量，避免悬浮球正好出现在鼠标光标下方导致的躲闪效果
    const randomOffsetX = Math.random() * 5 + 5; // 5-10px的随机偏移
    button.style.left = `${evt.pageX + randomOffsetX}px`;
    button.style.top = `${evt.pageY}px`;
  }
  button.style.zIndex = "9999";
  button.style.width = "25px";
  button.style.height = "25px";
  button.style.fontSize = "1em";
  button.style.borderRadius = "12.5px";
  button.style.cursor = this.settings.floatingButtonPinned ? "move" : "pointer";
  
  // 如果设置了常显，添加标识样式
  if (this.settings.floatingButtonPinned) {
    button.style.border = "2px solid var(--interactive-accent)";
    button.style.boxShadow = "0 0 8px rgba(66, 153, 225, 0.5)";
  }
  
  document.body.appendChild(button);

    // 拖动功能
    let isDragging = false;
    let offsetX, offsetY;
    let hasDragged = false;

    button.onmousedown = (e) => {
          // 如果是右键点击，不执行任何操作
          if (e.button === 2) return;
          
          // 中键点击：执行系统快捷键（可以触发其他应用功能）
          if (e.button === 1) {
            // 阻止默认行为和冒泡，防止干扰文本选择
            e.preventDefault();
            e.stopPropagation();
            
            try {
              // 使用设置中的快捷键配置
              const key = this.settings.middleClickShortcutKey || 'a';
              const altKey = this.settings.middleClickShortcutAlt === true;
              const ctrlKey = this.settings.middleClickShortcutCtrl === true;
              const shiftKey = this.settings.middleClickShortcutShift === true;
              const metaKey = this.settings.middleClickShortcutMeta === true;
              
              // 打印详细调试信息
              console.log("中键点击执行快捷键:", {
                key: key,
                altKey: altKey,
                ctrlKey: ctrlKey,
                shiftKey: shiftKey,
                metaKey: metaKey,
                activeElement: document.activeElement ? document.activeElement.tagName : 'none',
                editorAvailable: app.workspace.activeEditor ? true : false
              });
              
              // 构建快捷键文本（不再显示提示）
              const shortcutText = `${altKey ? 'Alt+' : ''}${ctrlKey ? 'Ctrl+' : ''}${shiftKey ? 'Shift+' : ''}${metaKey ? 'Win+' : ''}${key.toUpperCase()}`;
              
              // 获取当前选中的文本范围
              let selectionRange = null;
              const selection = window.getSelection();
              if (selection.rangeCount > 0 && !selection.isCollapsed) {
                selectionRange = selection.getRangeAt(0);
              }
              
              // 方案1：尝试使用Obsidian API直接执行常用命令
              const success = executeObsidianCommand(ctrlKey, shiftKey, altKey, metaKey, key);
              if (success) {
                return;
              }
              
              // 方案2：针对可编辑元素，尝试直接使用execCommand
              const activeElement = document.activeElement;
              if (activeElement && (activeElement.isContentEditable || activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
                try {
                  // 恢复文本选择（如果有）
                  if (selectionRange) {
                    selection.removeAllRanges();
                    selection.addRange(selectionRange);
                  }
                  
                  // 常用编辑命令
                  if (ctrlKey && key.toLowerCase() === 'b') {
                    document.execCommand('bold', false, null);
                    console.log("使用 execCommand 执行了加粗操作");
                    return;
                  } else if (ctrlKey && key.toLowerCase() === 'i') {
                    document.execCommand('italic', false, null);
                    console.log("使用 execCommand 执行了斜体操作");
                    return;
                  } else if (ctrlKey && key.toLowerCase() === 'u') {
                    document.execCommand('underline', false, null);
                    console.log("使用 execCommand 执行了下划线操作");
                    return;
                  }
                } catch (execError) {
                  console.log("execCommand 不可用或操作不支持", execError);
                }
              }
              
              // 方案3：创建并分发键盘事件
              // 创建键盘事件配置
              const eventConfig = {
                key: key,
                code: key.length === 1 && /[a-zA-Z]/.test(key) ? 'Key' + key.toUpperCase() : 
                      key.length === 1 && /[0-9]/.test(key) ? 'Digit' + key : key,
                altKey: altKey,
                ctrlKey: ctrlKey,
                shiftKey: shiftKey,
                metaKey: metaKey,
                bubbles: true,
                cancelable: true,
                composed: true,
                view: window,
                repeat: false,
                isComposing: false
              };
              
              // 只向当前活动元素分发事件，避免多次执行
              const target = document.activeElement || document.body;
              
              // 恢复文本选择（如果有）
              if (selectionRange) {
                selection.removeAllRanges();
                selection.addRange(selectionRange);
              }
              
              // 模拟按键过程：keydown -> keyup
              setTimeout(() => {
                try {
                  // 分发keydown事件
                  try {
                    const keydownEvent = new KeyboardEvent('keydown', eventConfig);
                    target.dispatchEvent(keydownEvent);
                  } catch (e) {}
                  
                  // 添加小延迟后分发keyup事件
                  setTimeout(() => {
                    try {
                      const keyupEvent = new KeyboardEvent('keyup', eventConfig);
                      target.dispatchEvent(keyupEvent);
                    } catch (e) {}
                  }, 10);
                } catch (eventError) {
                  console.error("模拟键盘事件失败:", eventError);
                }
              }, 5);
              
            } catch (error) {
              console.error("中键点击执行快捷键失败:", error);
            }
            return;
          }
          
          // 辅助函数：尝试使用Obsidian API执行常用命令
          function executeObsidianCommand(ctrlKey, shiftKey, altKey, metaKey, key) {
            try {
              if (app && app.commands) {
                // 构建快捷键组合字符串
                const modifiers = [];
                if (altKey) modifiers.push('Alt');
                if (ctrlKey) modifiers.push('Ctrl');
                if (shiftKey) modifiers.push('Shift');
                if (metaKey) modifiers.push('Meta');
                const shortcut = modifiers.join('+') + '+' + key.toUpperCase();
                
                console.log("尝试使用Obsidian API执行命令，快捷键组合:", shortcut);
                
                // 直接映射常用命令，避免使用可能不存在的findKeyAssignments方法
                const keyCommandMap = {
                  'b': 'editor:toggle-bold',
                  'i': 'editor:toggle-italic',
                  'u': 'editor:toggle-underline',
                  'h': 'editor:toggle-heading',
                  'l': 'editor:toggle-link',
                  'k': 'editor:insert-link',
                  'd': 'editor:delete-current-line',
                  'z': 'editor:undo',
                  'y': 'editor:redo'
                };
                
                // 对于Ctrl+Shift+快捷键
                const shiftKeyCommandMap = {
                  'b': 'editor:toggle-bullet-list',
                  'n': 'editor:toggle-numbered-list',
                  'h': 'editor:toggle-heading',
                  'k': 'editor:insert-wikilink'
                };
                
                // 根据修饰键和按键查找对应的命令ID
                let commandId = null;
                if (shiftKey && shiftKeyCommandMap[key.toLowerCase()]) {
                  commandId = shiftKeyCommandMap[key.toLowerCase()];
                } else if (ctrlKey && keyCommandMap[key.toLowerCase()]) {
                  commandId = keyCommandMap[key.toLowerCase()];
                }
                
                // 如果找到对应的命令，执行它
                if (commandId) {
                  console.log("执行Obsidian命令:", commandId);
                  app.commands.executeCommandById(commandId);
                  return true;
                }
              }
            } catch (apiError) {
              console.log("Obsidian API执行失败:", apiError);
            }
            return false;
          }
          
          // 左键点击且是常显状态：触发拖动
          if (this.settings.floatingButtonPinned) {
            isDragging = true;
            hasDragged = false;
            const rect = button.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            
            // 提高层级防止被其他元素遮挡
            button.style.zIndex = "10001";
          }
        };

    document.onmousemove = (e) => {
      if (isDragging && this.settings.floatingButtonPinned) {
        e.preventDefault();
        hasDragged = true;
        const x = e.clientX - offsetX;
        const y = e.clientY - offsetY;
        
        // 限制在视口内
        const maxX = window.innerWidth - button.offsetWidth;
        const maxY = window.innerHeight - button.offsetHeight;
        
        button.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
        button.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
        button.style.transform = "none";
      }
    };

    document.onmouseup = () => {
      if (isDragging) {
        isDragging = false;
        button.style.zIndex = "9999";
        
        // 如果是常显状态，保存悬浮球的位置
        if (this.settings.floatingButtonPinned) {
          const rect = button.getBoundingClientRect();
          this.settings.floatingButtonX = rect.left;
          this.settings.floatingButtonY = rect.top;
          this.saveSettings();
        }
        
        // 使用setTimeout确保点击事件不会被触发
        setTimeout(() => {
          hasDragged = false;
        }, 0);
      }
    };

    // selectionchange事件处理函数 - 增加防抖逻辑
    const handleSelectionChange = () => {
      if (!this.settings.floatingButtonPinned) {
        const currentSelection = window.getSelection();
        // 如果没有选中文本或选中区域已折叠（光标状态），则移除悬浮球
        if (!currentSelection || currentSelection.isCollapsed || !currentSelection.toString().trim()) {
          // 添加延迟，避免频繁移除和创建悬浮球
          setTimeout(() => {
            // 再次检查选择状态，确保在延迟期间没有新的选择
            const checkSelection = window.getSelection();
            if (!checkSelection || checkSelection.isCollapsed || !checkSelection.toString().trim()) {
              cleanupFloatingButton();
            }
          }, 300);
        }
      }
    };

    // 统一的清理函数，负责移除悬浮球和所有事件监听器
    const cleanupFloatingButton = () => {
      if (!this.settings.floatingButtonPinned) {
        button.remove();
        // 移除selectionchange事件监听器以避免内存泄漏
        document.removeEventListener('selectionchange', handleSelectionChange);
      }
    };

    // 将remove函数重定向到统一的清理函数
    const remove = cleanupFloatingButton;
    
    // 添加事件监听器
    document.addEventListener('selectionchange', handleSelectionChange);

    button.onclick = (e) => {
      // 如果有拖动行为，不触发点击功能
      if (hasDragged) {
        hasDragged = false;
        return;
      }
      
      // 获取当前激活的编辑器和最新的文本选择
      const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
      const currentEditor = activeLeaf?.editor;
      let currentSelection = '';
      
      // 优先尝试从当前激活的编辑器获取最新选择
      if (currentEditor) {
        currentSelection = currentEditor.getSelection();
      }
      
      // 如果没有获取到选择，或者选择为空，尝试使用传入的selection参数作为备选
      if (!currentSelection || currentSelection.trim() === '') {
        currentSelection = selection || '';
      }
      
      if (this.settings.boldOnClick && currentEditor && currentSelection) {
        if (!currentSelection.startsWith("**") && !currentSelection.endsWith("**")) {
          currentEditor.replaceSelection(`**${currentSelection}**`);
        }
      }
      
      new AskModal(this.app, this, currentSelection, currentEditor).open();
      remove();
    };


    // 鼠标悬停：弹出菜单
    let menuTimeout;
    let menuAlreadyShown = false; // 标记菜单是否已经显示
    
    button.onmouseenter = (e) => {
      // 清除之前可能存在的超时计时器
      clearTimeout(menuTimeout);
      
      // 如果正在拖动，不显示菜单
      if (!isDragging && !menuAlreadyShown) {
        // 创建菜单并传递鼠标事件参数
        showMenu(e);
        menuAlreadyShown = true;
        
        // 增加延迟时间到200ms，减少菜单的频繁创建
        setTimeout(() => {
          menuAlreadyShown = false;
        }, 200);
      }
    };
    
    // 防止默认的右键菜单显示
    button.oncontextmenu = (e) => {
      e.preventDefault();
    };
    
    // 显示菜单的函数
    const showMenu = (e) => {
      // 防止频繁创建菜单导致的闪烁
      const existingMenu = document.querySelector(".ask-ai-menu");
      if (existingMenu) {
        existingMenu.remove();
      }

      const menu = document.createElement("div");
      menu.className = "ask-ai-menu";
      menu.style.position = "absolute";
      menu.style.background = "var(--background-primary)";
      menu.style.border = "1px solid var(--background-modifier-border)";
      menu.style.padding = "4px";
      menu.style.borderRadius = "6px";
      menu.style.zIndex = "10000";
      menu.style.minWidth = "150px";
      
      // 先将菜单添加到DOM，以便获取其尺寸
      document.body.appendChild(menu);
      
      // 获取视口尺寸
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      // 获取菜单尺寸
      const menuWidth = menu.offsetWidth;
      const menuHeight = menu.offsetHeight;
      
      // 计算菜单位置，确保与悬浮球保持一定距离
      // 悬浮球尺寸为25x25像素，设置10像素的间距
      const buttonRect = button.getBoundingClientRect();
      let menuX = buttonRect.left + buttonRect.width + 10; // 显示在悬浮球右侧10像素处
      let menuY = buttonRect.top; // 与悬浮球顶部对齐
      
      // 如果菜单右侧超出视口，调整到悬浮球左侧显示，保持相同间距
      if (menuX + menuWidth > viewportWidth) {
        menuX = buttonRect.left - menuWidth - 10;
      }
      
      // 确保菜单不会超出视口左边界
      if (menuX < 0) {
        menuX = 10;
      }
      
      // 如果菜单底部超出视口，调整到上方显示
      if (menuY + menuHeight > viewportHeight) {
        menuY = viewportHeight - menuHeight - 10;
      }
      
      // 设置菜单最终位置
      menu.style.left = `${menuX}px`;
      menu.style.top = `${menuY}px`;

      // 下划线选项 - 带删除线二级菜单
      const underlineItem = document.createElement("div");
      underlineItem.textContent = "下划线";
      underlineItem.style.padding = "4px 8px";
      underlineItem.style.cursor = "pointer";
      underlineItem.style.borderBottom = "1px solid #eee";
      underlineItem.onmouseenter = () => {
        underlineItem.style.background = "var(--background-modifier-hover)";
        // 显示删除线二级菜单
        showStrikethroughSubMenu();
      }
      underlineItem.onmouseleave = () => {
        underlineItem.style.background = "transparent";
        // 延迟隐藏二级菜单，避免鼠标快速移动时闪烁
        setTimeout(() => {
          if (!strikethroughSubMenuHovered) {
            hideStrikethroughSubMenu();
          }
        }, 200);
      };
      underlineItem.onclick = (e) => {
        // 阻止事件冒泡，防止触发外部点击事件监听器
        e.stopPropagation();
        if (editor) {
          const sel = editor.getSelection();
          if (sel && !sel.startsWith("<u>") && !sel.endsWith("</u>")) {
            const cursor = editor.getCursor();
            const selectedText = editor.getSelection();
            editor.replaceSelection(`<u>${selectedText}</u>`);
            // 重新选中处理后的文本
            const newCursor = editor.getCursor();
            editor.setSelection({
              line: cursor.line,
              ch: cursor.ch
            }, {
              line: newCursor.line,
              ch: newCursor.ch
            });
          }
        }
        // 明确隐藏删除线二级菜单，但不退出主菜单
        hideStrikethroughSubMenu();
        // 确保菜单项点击后菜单仍然保持打开状态
        clearTimeout(menuTimeout);
      };
      menu.appendChild(underlineItem);

      // 删除线二级菜单变量
      let strikethroughSubMenu = null;
      
      // 显示删除线二级菜单
      const showStrikethroughSubMenu = () => {
        // 如果已经存在则移除
        hideStrikethroughSubMenu();
        
        // 创建二级菜单
        strikethroughSubMenu = document.createElement("div");
        strikethroughSubMenu.className = "ask-ai-submenu";
        strikethroughSubMenu.style.position = "absolute";
        
        strikethroughSubMenu.style.background = "var(--background-primary)";
        strikethroughSubMenu.style.border = "1px solid var(--background-modifier-border)";
        strikethroughSubMenu.style.padding = "4px";
        strikethroughSubMenu.style.borderRadius = "6px";
        strikethroughSubMenu.style.zIndex = "10001";
        strikethroughSubMenu.style.minWidth = "100px";
        
        // 先将二级菜单添加到DOM，以便获取其尺寸
        document.body.appendChild(strikethroughSubMenu);
        
        // 添加删除线选项
        const strikethroughItem = document.createElement("div");
        strikethroughItem.textContent = "删除线";
        strikethroughItem.style.padding = "4px 8px";
        strikethroughItem.style.cursor = "pointer";
        strikethroughItem.style.borderBottom = "1px solid #eee";
        
        // 鼠标悬停效果
        strikethroughItem.onmouseenter = () => {
          strikethroughItem.style.background = "var(--background-modifier-hover)";
        };
        strikethroughItem.onmouseleave = () => {
          strikethroughItem.style.background = "transparent";
        };
        
        // 点击删除线选项的处理
        strikethroughItem.onclick = (e) => {
          // 阻止事件冒泡，防止触发外部点击事件监听器
          e.stopPropagation();
          if (editor) {
            const sel = editor.getSelection();
            if (sel) {
              const cursor = editor.getCursor();
              const selectedText = editor.getSelection();
              editor.replaceSelection(`<s>${selectedText}</s>`);
              // 重新选中处理后的文本
              const newCursor = editor.getCursor();
              editor.setSelection({
                line: cursor.line,
                ch: cursor.ch
              }, {
                line: newCursor.line,
                ch: newCursor.ch
              });
            }
          }
          // 隐藏二级菜单，但不退出主菜单
          hideStrikethroughSubMenu();
          // 确保菜单项点击后菜单仍然保持打开状态
          clearTimeout(menuTimeout);
        };
        
        strikethroughSubMenu.appendChild(strikethroughItem);
        
        // 获取视口尺寸
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // 获取下划线选项和主菜单的位置
        const underlineItemRect = underlineItem.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        
        // 获取二级菜单尺寸
        const subMenuWidth = strikethroughSubMenu.offsetWidth;
        const subMenuHeight = strikethroughSubMenu.offsetHeight;
        
        // 计算二级菜单位置
        let subMenuX = menuRect.left + menuRect.width + 5; // 默认在主菜单右侧
        let subMenuY = menuRect.top + underlineItem.offsetTop;
        
        // 如果右侧超出视口，显示在主菜单左侧
        if (subMenuX + subMenuWidth > viewportWidth) {
          subMenuX = menuRect.left - subMenuWidth - 5;
        }
        
        // 如果底部超出视口，调整垂直位置
        if (subMenuY + subMenuHeight > viewportHeight) {
          subMenuY = Math.max(0, viewportHeight - subMenuHeight - 10);
        }
        
        // 设置二级菜单最终位置
        strikethroughSubMenu.style.left = `${subMenuX}px`;
        strikethroughSubMenu.style.top = `${subMenuY}px`;
        
        // 添加二级菜单的hover状态追踪
      strikethroughSubMenu.onmouseenter = () => {
        strikethroughSubMenuHovered = true;
        clearTimeout(menuTimeout); // 当鼠标进入二级菜单时，清除一级菜单的移除计时器
      };
        strikethroughSubMenu.onmouseleave = () => {
          strikethroughSubMenuHovered = false;
          hideStrikethroughSubMenu();
        };
      };
      
      // 隐藏删除线二级菜单
      const hideStrikethroughSubMenu = () => {
        if (strikethroughSubMenu) {
          strikethroughSubMenu.remove();
          strikethroughSubMenu = null;
          // 确保状态被正确重置
          strikethroughSubMenuHovered = false;
        }
      };

      // 编辑问题选项 - 带模板二级菜单
      const editItem = document.createElement("div");
      editItem.textContent = "编辑问题";
      editItem.style.padding = "4px 8px";
      editItem.style.cursor = "pointer";
      editItem.style.borderBottom = "1px solid #eee";
      editItem.onmouseenter = () => {
        editItem.style.background = "var(--background-modifier-hover)";
        // 显示二级菜单（模板列表）
        showTemplateSubMenu();
      };
      editItem.onmouseleave = () => {
        editItem.style.background = "transparent";
        // 延迟隐藏二级菜单，避免鼠标快速移动时闪烁
        setTimeout(() => {
          if (!subMenuHovered) {
            hideTemplateSubMenu();
          }
        }, 200);
      };
      editItem.onclick = (e) => {
        // 阻止事件冒泡，防止触发外部点击事件监听器
        e.stopPropagation();
        // 明确隐藏模板二级菜单
        hideTemplateSubMenu();
        // 直接弹出AI编辑弹窗，输入区预填用户选择内容，不自动发送prompt
        const modal = new AskModal(this.app, this, selection, editor);
        modal._editMode = true;
        modal.open();
        // 不立即关闭菜单，让用户通过鼠标离开自然关闭
        menuTimeout = setTimeout(() => {
          menu.remove();
          remove();
        }, 500); // 稍微延迟关闭，让模态框先打开
      };
      menu.appendChild(editItem);
      
      // 二级菜单变量
      let templateSubMenu = null;
      
      // 显示模板二级菜单
      const showTemplateSubMenu = () => {
        // 如果已经存在则移除
        hideTemplateSubMenu();
        
        // 获取当前插件设置的模板
        const templates = this.settings.promptTemplates || [];
        
        // 如果没有模板，不显示二级菜单
        if (!templates.length) return;
        
        // 创建二级菜单
        templateSubMenu = document.createElement("div");
        templateSubMenu.className = "ask-ai-submenu";
        templateSubMenu.style.position = "absolute";
        
        templateSubMenu.style.background = "var(--background-primary)";
        templateSubMenu.style.border = "1px solid var(--background-modifier-border)";
        templateSubMenu.style.padding = "4px";
        templateSubMenu.style.borderRadius = "6px";
        templateSubMenu.style.zIndex = "10001";
      templateSubMenu.style.minWidth = "200px";
      templateSubMenu.style.maxWidth = "300px"; // 限制最大宽度
      templateSubMenu.style.whiteSpace = "normal"; // 允许文本自动换行
      templateSubMenu.style.wordWrap = "break-word"; // 允许单词内换行
        
        // 先将二级菜单添加到DOM，以便获取其尺寸
        document.body.appendChild(templateSubMenu);
        
        // 添加模板项到二级菜单（在获取尺寸前先添加内容，确保计算准确）
        templates.forEach((template, index) => {
          const templateItem = document.createElement("div");
          // 使用模板的第一行作为显示文本
          const displayText = template.template.split('\n')[0] || "空模板";
          templateItem.textContent = displayText;
          templateItem.style.padding = "4px 8px";
          templateItem.style.cursor = "pointer";
          templateItem.style.borderBottom = "1px solid #eee";
          
          // 检查是否为默认提示词，如果是则设置墨绿色
          if (this.settings.defaultPromptIndex === index) {
            templateItem.style.color = "#006400"; // 墨绿色
            templateItem.style.fontWeight = "bold";
          }
          
          // 鼠标悬停效果
          templateItem.onmouseenter = () => {
            templateItem.style.background = "var(--background-modifier-hover)";
          };
          templateItem.onmouseleave = () => {
            templateItem.style.background = "transparent";
          };
          
          // 点击模板时的处理（临时空实现，稍后会替换）
          templateItem.onclick = (e) => {
              // 阻止事件冒泡，防止触发外部点击事件监听器
              e.stopPropagation();
          };
          
          // 右键点击直接设置为默认提示词
          templateItem.oncontextmenu = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // 更新默认提示词索引
            this.settings.defaultPromptIndex = index;
            await this.saveSettings();
            
            // 重新显示二级菜单，以便更新样式
            hideTemplateSubMenu();
            showTemplateSubMenu();
          };
          
          templateSubMenu.appendChild(templateItem);
        });
        
        // 获取视口尺寸
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // 获取编辑问题项和主菜单的位置
        const editItemRect = editItem.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        
        // 获取二级菜单尺寸
        const subMenuWidth = templateSubMenu.offsetWidth;
        const subMenuHeight = templateSubMenu.offsetHeight;
        
        // 计算二级菜单位置
        let subMenuX = menuRect.left + menuRect.width + 5; // 默认在主菜单右侧
        let subMenuY = menuRect.top + editItem.offsetTop;
        
        // 如果右侧超出视口，显示在主菜单左侧
        if (subMenuX + subMenuWidth > viewportWidth) {
          subMenuX = menuRect.left - subMenuWidth - 5;
        }
        
        // 如果底部超出视口，调整垂直位置
        if (subMenuY + subMenuHeight > viewportHeight) {
          subMenuY = Math.max(0, viewportHeight - subMenuHeight - 10);
        }
        
        // 设置二级菜单最终位置
        templateSubMenu.style.left = `${subMenuX}px`;
        templateSubMenu.style.top = `${subMenuY}px`;
        
        // 重新添加正确的点击事件处理函数（替换临时空实现）
        Array.from(templateSubMenu.children).forEach((templateItem, index) => {
          templateItem.onclick = (e) => {
            // 阻止事件冒泡，防止触发外部点击事件监听器
            e.stopPropagation();
            // 隐藏二级菜单
            hideTemplateSubMenu();
            
            // 创建模态框并传递原始选中内容和模板
            const modal = new AskModal(this.app, this, selection, editor, null, templates[index].template);
            modal._editMode = false; // 非编辑模式，直接发送
            modal.open();
            
            // 不立即关闭主菜单，让用户通过鼠标离开自然关闭
            menuTimeout = setTimeout(() => {
              menu.remove();
              remove();
            }, 500); // 稍微延迟关闭，让模态框先打开
          };
        });
        
        // 添加二级菜单的hover状态追踪
        templateSubMenu.onmouseenter = () => {
          subMenuHovered = true;
          clearTimeout(menuTimeout); // 当鼠标进入二级菜单时，清除一级菜单的移除计时器
        };
        templateSubMenu.onmouseleave = () => {
          subMenuHovered = false;
          hideTemplateSubMenu();
        };
      };
      
      // 隐藏模板二级菜单
      const hideTemplateSubMenu = () => {
        if (templateSubMenu) {
          templateSubMenu.remove();
          templateSubMenu = null;
        }
      };
      


      // 移除HTML标签选项
      const removeHtmlTagsItem = document.createElement("div");
      removeHtmlTagsItem.textContent = "移除HTML标签";
      removeHtmlTagsItem.style.padding = "4px 8px";
      removeHtmlTagsItem.style.cursor = "pointer";
      removeHtmlTagsItem.style.borderBottom = "1px solid #eee";
      removeHtmlTagsItem.onmouseenter = () => removeHtmlTagsItem.style.background = "var(--background-modifier-hover)";
      removeHtmlTagsItem.onmouseleave = () => removeHtmlTagsItem.style.background = "transparent";
      removeHtmlTagsItem.onclick = (e) => {
        // 阻止事件冒泡，防止触发外部点击事件监听器
        e.stopPropagation();
        if (editor) {
          try {
            const selection = editor.getSelection();
            if (!selection || selection.length === 0) return;

            // 原始选区起点偏移
            const fromPos = editor.getCursor('from');
            const fromIdx = editor.posToOffset(fromPos);

            // 清理 HTML 标签
            const cleaned = selection.replace(/<[^>]*>/g, '');

            // 替换
            editor.replaceSelection(cleaned);

            // 新选区：起点不变，终点 = 起点 + cleaned.length
            const newFrom = editor.offsetToPos(fromIdx);
            const newTo = editor.offsetToPos(fromIdx + cleaned.length);

            editor.setSelection(newFrom, newTo);
            editor.focus();
          } catch (err) {
            console.error('移除HTML标签错误:', err);
          }
        }
        // 确保菜单项点击后菜单仍然保持打开状态
        clearTimeout(menuTimeout);
      };
      menu.appendChild(removeHtmlTagsItem);

      // 移除空行选项
      const removeEmptyLinesItem = document.createElement("div");
      removeEmptyLinesItem.textContent = "移除空行";
      removeEmptyLinesItem.style.padding = "4px 8px";
      removeEmptyLinesItem.style.cursor = "pointer";
      removeEmptyLinesItem.style.borderBottom = "1px solid #eee";
      removeEmptyLinesItem.onmouseenter = () => removeEmptyLinesItem.style.background = "var(--background-modifier-hover)";
      removeEmptyLinesItem.onmouseleave = () => removeEmptyLinesItem.style.background = "transparent";
      removeEmptyLinesItem.onclick = (e) => {
        // 阻止事件冒泡，防止触发外部点击事件监听器
        e.stopPropagation();
        if (editor) {
          try {
            const selection = editor.getSelection();
            if (!selection || selection.length === 0) return;

            // 保存原始选区起点偏移
            const fromPos = editor.getCursor('from');
            const fromIdx = editor.posToOffset(fromPos);

            // 移除空行（只含空格的行也算空行）
            const cleaned = selection
              .split('\n')
              .filter(line => line.trim().length > 0)
              .join('\n');

            // 替换为清理后的文本
            editor.replaceSelection(cleaned);

            // 新的选区范围
            const newFrom = editor.offsetToPos(fromIdx);
            const newTo = editor.offsetToPos(fromIdx + cleaned.length);

            editor.setSelection(newFrom, newTo);
            editor.focus();
          } catch (err) {
            console.error('RemoveEmptyLinesPlugin error:', err);
            new Notice('移除空行时出错，请查看控制台。');
          }
        }
        // 确保菜单项点击后菜单仍然保持打开状态
        clearTimeout(menuTimeout);
      };
      menu.appendChild(removeEmptyLinesItem);

      // 清除格式选项
      const clearFormatItem = document.createElement("div");
      clearFormatItem.textContent = "清除格式";
      clearFormatItem.style.padding = "4px 8px";
      clearFormatItem.style.cursor = "pointer";
      clearFormatItem.style.borderBottom = "1px solid #eee";
      clearFormatItem.onmouseenter = () => clearFormatItem.style.background = "var(--background-modifier-hover)";
      clearFormatItem.onmouseleave = () => clearFormatItem.style.background = "transparent";
      clearFormatItem.onclick = (e) => {
        // 阻止事件冒泡，防止触发外部点击事件监听器
        e.stopPropagation();
        if (editor) {
          const sel = editor.getSelection();
          if (sel) {
            const cursor = editor.getCursor();
            // 使用正则表达式清除格式
            const textWithoutFormat = sel
              // 去除加粗、斜体、删除线、行内代码、标题、横线
              .replace(/\*\*(.*?)\*\*/g, '$1')
              .replace(/\*(.*?)\*/g, '$1')
              .replace(/~~(.*?)~~/g, '$1')
              .replace(/`(.*?)`/g, '$1')
              .replace(/^#+\s+/gm, '')
              .replace(/^-{3,}$/gm, '')
              // 去除序号后的小圆点（如 1. 2. 3.）
              .replace(/^(\d+)\.\s*/gm, '$1 ')
              .replace(/^\s*(\d+)\.\s*/gm, '$1 ')
              // 去除一行开头的圆点(*)
              .replace(/^\s*\*\s*/gm, '');
            editor.replaceSelection(textWithoutFormat);
            // 重新选中处理后的文本
            setTimeout(() => {
              const newCursor = editor.getCursor();
              editor.setSelection({
                line: cursor.line,
                ch: cursor.ch
              }, {
                line: newCursor.line,
                ch: newCursor.ch - (sel.length - textWithoutFormat.length)
              });
            }, 10);
          }
        }
        // 确保菜单项点击后菜单仍然保持打开状态
        clearTimeout(menuTimeout);
      };
      menu.appendChild(clearFormatItem);

      // 降低标题层级选项
      const decreaseHeadingLevelItem = document.createElement("div");
      decreaseHeadingLevelItem.textContent = "降低标题层级";
      decreaseHeadingLevelItem.style.padding = "4px 8px";
      decreaseHeadingLevelItem.style.cursor = "pointer";
      decreaseHeadingLevelItem.style.borderBottom = "1px solid #eee";
      decreaseHeadingLevelItem.onmouseenter = () => decreaseHeadingLevelItem.style.background = "var(--background-modifier-hover)";
      decreaseHeadingLevelItem.onmouseleave = () => decreaseHeadingLevelItem.style.background = "transparent";
      decreaseHeadingLevelItem.onclick = (e) => {
        // 阻止事件冒泡，防止触发外部点击事件监听器
        e.stopPropagation();
        if (editor) {
          const sel = editor.getSelection();
          if (sel) {
            // 保存原始选区起点偏移
            const fromPos = editor.getCursor('from');
            const fromIdx = editor.posToOffset(fromPos);

            // 从最低层级开始执行，将标题层级下降一级
            // 先按行拆分
            const lines = sel.split('\n');
            // 从最低层级开始处理，防止处理顺序问题
            const processedLines = lines.map(line => {
              // 匹配以1-5个#开头的标题行
              const headingMatch = line.match(/^(#{1,5})\s+(.*)$/);
              if (headingMatch) {
                // 获取#部分和标题内容
                const hashes = headingMatch[1];
                const content = headingMatch[2];
                // 增加一个#，将标题层级下降一级
                return '#' + hashes + ' ' + content;
              }
              return line;
            });
            // 重新组合文本
            const resultText = processedLines.join('\n');

            // 替换为处理后的文本
            editor.replaceSelection(resultText);

            // 新的选区范围
            const newFrom = editor.offsetToPos(fromIdx);
            const newTo = editor.offsetToPos(fromIdx + resultText.length);

            editor.setSelection(newFrom, newTo);
            editor.focus();
          }
        }
        // 确保菜单项点击后菜单仍然保持打开状态
        clearTimeout(menuTimeout);
      };
      menu.appendChild(decreaseHeadingLevelItem);

      // 自定义快捷键选项
      const customShortcutItem = document.createElement("div");
      customShortcutItem.textContent = this.settings.customShortcutName || "自定义快捷键";
      customShortcutItem.style.padding = "4px 8px";
      customShortcutItem.style.cursor = "pointer";
      customShortcutItem.style.borderBottom = "1px solid #eee";
      customShortcutItem.onmouseenter = () => customShortcutItem.style.background = "var(--background-modifier-hover)";
      customShortcutItem.onmouseleave = () => customShortcutItem.style.background = "transparent";
      customShortcutItem.onclick = (e) => {
        // 阻止事件冒泡，防止触发外部点击事件监听器
        e.stopPropagation();
        
        // 执行自定义快捷键
        try {
          const modifiers = [];
          if (this.settings.customShortcutAlt) modifiers.push('Alt');
          if (this.settings.customShortcutCtrl) modifiers.push('Control');
          if (this.settings.customShortcutShift) modifiers.push('Shift');
          if (this.settings.customShortcutMeta) modifiers.push('Meta');
          
          const key = this.settings.customShortcutKey || 'b';
          
          // 模拟按键事件
          const activeElement = document.activeElement;
          const textareaElement = activeElement instanceof HTMLTextAreaElement || activeElement instanceof HTMLInputElement ? activeElement : document.body;
          
          // 模拟 keydown 事件
          const keydownEvent = new KeyboardEvent('keydown', {
            key: key,
            code: `Key${key.toUpperCase()}`,
            altKey: this.settings.customShortcutAlt,
            ctrlKey: this.settings.customShortcutCtrl,
            shiftKey: this.settings.customShortcutShift,
            metaKey: this.settings.customShortcutMeta,
            bubbles: true,
            cancelable: true,
            view: window
          });
          
          // 模拟 keyup 事件
          const keyupEvent = new KeyboardEvent('keyup', {
            key: key,
            code: `Key${key.toUpperCase()}`,
            altKey: this.settings.customShortcutAlt,
            ctrlKey: this.settings.customShortcutCtrl,
            shiftKey: this.settings.customShortcutShift,
            metaKey: this.settings.customShortcutMeta,
            bubbles: true,
            cancelable: true,
            view: window
          });
          
          // 分发事件
          textareaElement.dispatchEvent(keydownEvent);
          setTimeout(() => {
            textareaElement.dispatchEvent(keyupEvent);
          }, 50);
          
          console.log(`执行自定义快捷键: ${modifiers.join('+')}+${key}`);
        } catch (err) {
          console.error('执行自定义快捷键错误:', err);
          new Notice('执行自定义快捷键时出错，请查看控制台。');
        }
        
        // 确保菜单项点击后菜单仍然保持打开状态
        clearTimeout(menuTimeout);
      };
      menu.appendChild(customShortcutItem);

      // 悬浮球常显选项
      const divider = document.createElement("hr");
      divider.style.margin = "4px 0";
      divider.style.border = "none";
      divider.style.borderTop = "1px solid var(--background-modifier-border)";
      menu.appendChild(divider);
      const floatPinnedItem = document.createElement("div");
      floatPinnedItem.textContent = this.settings.floatingButtonPinned ? "取消悬浮球常显" : "悬浮球常显";
      floatPinnedItem.style.padding = "4px 8px";
      floatPinnedItem.style.cursor = "pointer";
      floatPinnedItem.style.borderBottom = "1px solid #eee";
      floatPinnedItem.onmouseenter = () => floatPinnedItem.style.background = "var(--background-modifier-hover)";
      floatPinnedItem.onmouseleave = () => floatPinnedItem.style.background = "transparent";
      floatPinnedItem.onclick = async () => {
        const wasPinned = this.settings.floatingButtonPinned;
        this.settings.floatingButtonPinned = !this.settings.floatingButtonPinned;
        await this.saveSettings();
        
        // 更新按钮文本
        floatPinnedItem.textContent = this.settings.floatingButtonPinned ? "取消悬浮球常显" : "悬浮球常显";
        
        // 如果设置为常显，添加特定样式标识；如果取消常显，移除悬浮球
        if (this.settings.floatingButtonPinned) {
          button.style.border = "2px solid var(--interactive-accent)";
          button.style.boxShadow = "0 0 8px rgba(66, 153, 225, 0.5)";
        } else {
          button.style.border = "none";
          button.style.boxShadow = "none";
          // 如果是从常显状态切换到非常显状态，立即移除悬浮球
          if (wasPinned) {
            button.remove();
            menu.remove(); // 只有在移除按钮时才同时移除菜单
          }
        }
      };
      menu.appendChild(floatPinnedItem);

      // AI API 列表
      this.settings.apis.forEach((api, index) => {
        const item = document.createElement("div");
        item.textContent = api.name || `API ${index + 1}`;
        item.style.padding = "4px 8px";
        item.style.cursor = "pointer";
        item.onmouseenter = () =>
          (item.style.background = "var(--background-modifier-hover)");
        item.onmouseleave = () =>
          (item.style.background = "transparent");

        item.onclick = (e) => {
          // 阻止事件冒泡，防止触发外部点击事件监听器
          e.stopPropagation();
          new AskModal(this.app, this, selection, editor, index).open();
          // 不立即关闭菜单，让用户通过鼠标离开自然关闭
          menuTimeout = setTimeout(() => {
            menu.remove();
            remove();
          }, 500); // 稍微延迟关闭，让模态框先打开
        };

        menu.appendChild(item);
      });

      document.body.appendChild(menu);

      // 当鼠标离开菜单时移除菜单
      menu.onmouseleave = () => {
        // 延迟移除菜单，给用户足够的时间移动到二级菜单
        menuTimeout = setTimeout(() => {
          // 检查是否有选中文本，如果有则只移除菜单，保留悬浮球
          const currentSelection = window.getSelection();
          if (!currentSelection || currentSelection.isCollapsed || !currentSelection.toString().trim()) {
            menu.remove();
            cleanup();
          } else {
            // 如果仍然有选中文本，只移除菜单，保留悬浮球
            menu.remove();
            document.removeEventListener("click", handleClickOutside);
            clearTimeout(menuTimeout);
          }
        }, 300); // 增加延迟时间到300ms，比按钮的500ms稍短但足够用户操作
      };
      
      // 当鼠标离开按钮时，延迟移除菜单，给用户时间移动到菜单上
      button.onmouseleave = () => {
        menuTimeout = setTimeout(() => {
          // 只在鼠标没有移动到菜单上时才移除菜单和悬浮球
          // 检查是否有选中文本，如果有则不立即移除悬浮球
          const currentSelection = window.getSelection();
          if (!currentSelection || currentSelection.isCollapsed || !currentSelection.toString().trim()) {
            menu.remove();
            cleanup();
          } else {
            // 如果仍然有选中文本，只移除菜单，保留悬浮球
            menu.remove();
            document.removeEventListener("click", handleClickOutside);
            clearTimeout(menuTimeout);
          }
        }, 500); // 增加延迟时间到500ms，给用户更多时间操作
      };
      
      // 当鼠标进入菜单时，清除按钮离开的超时计时器
      menu.onmouseenter = () => {
        clearTimeout(menuTimeout);
      };
      
      // 清理函数
      const cleanup = () => {
        document.removeEventListener("click", handleClickOutside);
        clearTimeout(menuTimeout);
        // 确保所有二级菜单都被隐藏
        hideStrikethroughSubMenu();
        hideTemplateSubMenu();
        // 调用统一的清理函数处理悬浮球和selectionchange事件监听器
        remove();
      };
      
      // 点击外部时移除菜单
      const handleClickOutside = (e) => {
        if (!menu.contains(e.target) && e.target !== button) {
          menu.remove();
          cleanup();
        }
      };
      
      document.addEventListener("click", handleClickOutside);
    };

  }

  async handleSelection(editor) {
    // 尝试获取选中文本
    let selectedText = editor.getSelection();
    
    // 如果没有获取到选中文本，尝试使用window.getSelection作为后备
    if (!selectedText) {
      const windowSelection = window.getSelection();
      if (windowSelection && !windowSelection.isCollapsed && windowSelection.toString().trim()) {
        selectedText = windowSelection.toString().trim();
      }
    }
    
    // 如果仍然没有选中文字，使用短暂延迟后重试
    if (!selectedText) {
      // 添加延迟以确保编辑器有时间处理全选操作
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // 再次尝试获取选中文本
      selectedText = editor.getSelection();
      
      // 再次尝试使用window.getSelection作为后备
      if (!selectedText) {
        const windowSelection = window.getSelection();
        if (windowSelection && !windowSelection.isCollapsed && windowSelection.toString().trim()) {
          selectedText = windowSelection.toString().trim();
        }
      }
      
      // 如果仍然没有选中文字，才显示提示
      if (!selectedText) {
        new Notice("没有选中文字");
        return;
      }
    }
    
    new AskModal(this.app, this, selectedText, editor).open();
  }
};

class AskModal extends Modal {
  constructor(app, plugin, query, editor, apiIndex = null, selectedTemplate = null) {
    super(app);
    this.plugin = plugin;
    this.query = query;   // 选中的内容
    this.editor = editor; // 编辑器对象
    this.apiIndex = apiIndex;
    this.abortController = null;
    this.messages = [];   // 对话历史
    this._drag = { active: false, offsetX: 0, offsetY: 0 };
    this.context = "";   // 初始化上下文变量
    this.selectedTemplate = selectedTemplate; // 从二级菜单选中的模板
  }

  async onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    contentEl.addClass("ask-ai-modal");
    contentEl.style.userSelect = "text";
    
    // 计算上下文内容
    if (this.editor && this.query) {
      try {
        const cursor = this.editor.getCursor();
        // 获取选中内容前后的若干行作为上下文
        const startLine = Math.max(0, cursor.line - 2);
        const endLine = Math.min(this.editor.lineCount() - 1, cursor.line + 2);
        let contextText = "";
        for (let i = startLine; i <= endLine; i++) {
          contextText += this.editor.getLine(i) + "\n";
        }
        this.context = contextText.trim();
      } catch (error) {
        console.error("计算上下文失败:", error);
        this.context = "";
      }
    }

    // 让弹窗可拖动
    modalEl.style.position = "fixed";
    modalEl.style.zIndex = "99999";
    modalEl.style.left = "50%";
    modalEl.style.top = "20%";
    modalEl.style.transform = "translate(-50%, 0)";

    // 拖动逻辑
    let dragStartX, dragStartY, dragStartLeft, dragStartTop;
    const onDragMouseDown = (e) => {
      if (!e.target.classList.contains("ask-ai-modal-header")) return;
      this._drag.active = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = modalEl.getBoundingClientRect();
      dragStartLeft = rect.left;
      dragStartTop = rect.top;
      document.addEventListener("mousemove", onDragMouseMove);
      document.addEventListener("mouseup", onDragMouseUp);
      e.preventDefault();
    };
    const onDragMouseMove = (e) => {
      if (!this._drag.active) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      modalEl.style.left = `${dragStartLeft + dx}px`;
      modalEl.style.top = `${dragStartTop + dy}px`;
      modalEl.style.transform = "none";
    };
    const onDragMouseUp = () => {
      this._drag.active = false;
      document.removeEventListener("mousemove", onDragMouseMove);
      document.removeEventListener("mouseup", onDragMouseUp);
    };
    modalEl.addEventListener("mousedown", onDragMouseDown);

    // 标题
    let headerText = "AI 回答中...";
    if (this._editMode) {
      headerText = "🙋请在底部编辑问题";
    }
    const header = contentEl.createEl("h3", { text: headerText });
    header.classList.add("ask-ai-modal-header");
    header.style.cursor = "move";

    // 输出区
  this.textarea = contentEl.createEl("textarea");
  this.textarea.addClass("ask-ai-textarea");
    this.textarea.style.width = "100%";
    this.textarea.style.height = "300px";
    this.textarea.style.whiteSpace = "pre-wrap";
    this.textarea.style.lineHeight = "1.6";
    this.textarea.style.fontFamily = this.plugin.settings.defaultFontFamily || "";

    // 清除格式、复制、字体大小按钮
  const formatBtnRow = contentEl.createDiv();
  formatBtnRow.addClass("ask-ai-format-row");
    formatBtnRow.style.display = "flex";
    formatBtnRow.style.justifyContent = "flex-end";
    formatBtnRow.style.alignItems = "center";
    formatBtnRow.style.marginBottom = "10px";

    // Prompt选择下拉框
    const promptSelect = document.createElement("select");
    promptSelect.style.padding = "4px 8px";
    promptSelect.style.fontSize = "0.8em";
    promptSelect.style.marginRight = "8px";
    promptSelect.style.minWidth = "120px";
    
    // 填充下拉选项
    const fillPromptOptions = () => {
      promptSelect.innerHTML = "";
      
      // 添加一个占位符选项，默认不显示任何模板
      const placeholderOption = document.createElement("option");
      placeholderOption.value = "-1";
      placeholderOption.textContent = "选择模板...";
      promptSelect.appendChild(placeholderOption);
      
      // 显式设置占位符选项为选中状态，确保其显示
      placeholderOption.selected = true;
      promptSelect.selectedIndex = 0;
      
      // 强制触发DOM更新
      setTimeout(() => {
        promptSelect.selectedIndex = 0;
      }, 0);
      
      if (this.plugin.settings.promptTemplates && this.plugin.settings.promptTemplates.length > 0) {
        this.plugin.settings.promptTemplates.forEach((template, index) => {
            const option = document.createElement("option");
            option.value = index;
            // 显示Prompt的第一行作为选项文本
            const firstLine = template.template.split('\n')[0];
            option.textContent = firstLine || "空模板";
            // 不设置默认选中任何模板
            promptSelect.appendChild(option);
          });
      } else {
        const option = document.createElement("option");
        option.value = "0";
        option.textContent = "默认模板";
        promptSelect.appendChild(option);
      }
    };
    
    // 初始填充选项
    fillPromptOptions();
    
    // 处理模板选择的函数，可被多次调用
    const applyPromptTemplate = (selectedIndex) => {
      if (this.plugin.settings.promptTemplates && selectedIndex < this.plugin.settings.promptTemplates.length) {
        const selectedTemplate = this.plugin.settings.promptTemplates[selectedIndex];
        console.log("Selected prompt template:", selectedTemplate.name);
        
        // 如果是编辑模式，在文本末尾添加模板内容
      if (this._editMode && this.inputField) {
        // 替换模板中的变量
        let processedTemplate = selectedTemplate.template;
        if (this.query) {
          processedTemplate = processedTemplate.replace(/{{selection}}/g, this.query);
        }
        if (this.context) {
          processedTemplate = processedTemplate.replace(/{{context}}/g, this.context);
        }
        
        // 获取当前输入框内容
        const currentValue = this.inputField.value;
        
        // 在文本末尾添加模板内容
        this.inputField.value = currentValue + processedTemplate;
        
        // 重新聚焦并设置光标位置到文本末尾
        this.inputField.focus();
        const newCursorPos = this.inputField.value.length;
        this.inputField.setSelectionRange(newCursorPos, newCursorPos);
          
          // 确保视图固定在光标位置，不跳到文本末尾
          // 在下一个事件循环中操作，确保DOM已更新
          setTimeout(() => {
            if (this.inputField) {
              // 获取光标位置对应的行的高度
              const rect = this.inputField.getBoundingClientRect();
              const lineHeight = parseFloat(window.getComputedStyle(this.inputField).lineHeight);
              
              // 计算需要滚动的距离，使光标位置保持在视图中央或顶部
              const scrollTop = Math.max(0, (processedTemplate.match(/\n/g) || []).length * lineHeight - rect.height / 2);
              this.inputField.scrollTop = scrollTop;
            }
          }, 0);
          
          // 保存用户选择的模板索引
          this.selectedPromptIndex = selectedIndex;
        } else {
          // 保存用户选择的模板索引，供后续使用
          this.selectedPromptIndex = selectedIndex;
        }
      }
    };

    // 监听下拉选框变化事件
    promptSelect.addEventListener("change", (e) => {
      const selectedIndex = parseInt(e.target.value);
      // 跳过占位符选项
      if (selectedIndex !== -1) {
        applyPromptTemplate(selectedIndex);
      }
    });

    // 添加双击事件监听，双击当前选中的模板时应用它
    promptSelect.addEventListener("dblclick", () => {
      const selectedIndex = parseInt(promptSelect.value);
      // 跳过占位符选项
      if (selectedIndex !== -1 && this._editMode && this.inputField) {
        // 强制应用当前选中的模板
        applyPromptTemplate(selectedIndex);
      }
    });

    // 添加键盘事件支持，按下Enter键也能应用当前选中的模板
    promptSelect.addEventListener("keydown", (e) => {
      if (e.key === 'Enter' || e.keyCode === 13) {
        const selectedIndex = parseInt(promptSelect.value);
        // 跳过占位符选项
        if (selectedIndex !== -1 && this._editMode && this.inputField) {
          // 强制应用当前选中的模板
          applyPromptTemplate(selectedIndex);
          e.preventDefault(); // 阻止默认行为
        }
      }
    });
    
    formatBtnRow.appendChild(promptSelect);
    
    // 字体大小按钮
    const fontDecBtn = document.createElement("button");
    fontDecBtn.textContent = "A-";
    fontDecBtn.style.padding = "4px 8px";
    fontDecBtn.style.fontSize = "0.8em";
    fontDecBtn.style.marginRight = "8px";
    formatBtnRow.appendChild(fontDecBtn);

    const fontIncBtn = document.createElement("button");
    fontIncBtn.textContent = "A+";
    fontIncBtn.style.padding = "4px 8px";
    fontIncBtn.style.fontSize = "0.8em";
    fontIncBtn.style.marginRight = "8px";
    formatBtnRow.appendChild(fontIncBtn);

    // 插入自定义文本按钮
    const insertBtn = document.createElement("button");
    insertBtn.textContent = this.plugin?.settings?.customTextName || "自定义文本";
    insertBtn.style.padding = "4px 8px";
    insertBtn.style.fontSize = "0.8em";
    insertBtn.style.marginRight = "8px";
    insertBtn.onclick = () => {
      let selectedText = this.query || "";
      if (selectedText.length > 10) {
        selectedText = selectedText.slice(0, 10) + "...";
      }
      // 获取自定义文本内容并替换占位符
      let customText = this.plugin?.settings?.customTextContent || ">[!{{selection}}]\n";
      customText = customText.replace(/{{selection}}/g, selectedText);
      
      // 添加对{{modelname}}变量的支持
      let modelName = "";
      if (this.plugin?.settings?.apis && this.plugin?.settings?.apis.length > 0) {
        // 使用当前选择的API（通过悬浮球菜单选择的），如果没有选择则使用默认API
        const apiIndex = this.apiIndex ?? this.plugin.settings.defaultApiIndex ?? 0;
        const selectedApi = this.plugin.settings.apis[apiIndex];
        modelName = selectedApi?.model || selectedApi?.name || "";
      }
      customText = customText.replace(/{{modelname}}/g, modelName);
      
      // 在文本区域开头添加自定义文本
      this.textarea.value = customText + this.textarea.value;
      // 滚动到文本区域顶部，确保用户能看到新添加的内容
      this.textarea.scrollTop = 0;
    };
    formatBtnRow.appendChild(insertBtn);

    // 清除格式按钮
    const clearFormatBtn = document.createElement("button");
    clearFormatBtn.textContent = "清除格式";
    clearFormatBtn.style.padding = "4px 8px";
    clearFormatBtn.style.fontSize = "0.8em";
    clearFormatBtn.style.marginRight = "8px";
    clearFormatBtn.onclick = () => {
      const currentText = this.textarea.value;
      const cleanedText = currentText
        // 去除加粗、斜体、删除线、行内代码、标题、横线、多余空行
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/~~(.*?)~~/g, '$1')
        .replace(/`(.*?)`/g, '$1')
        .replace(/^#+\s+/gm, '')
        .replace(/^-{3,}$/gm, '')
        .replace(/\n{2,}/g, '\n')
        // 去除序号后的小圆点（如 1. 2. 3.）
        .replace(/^(\d+)\.\s*/gm, '$1 ') 
        .replace(/^\s*(\d+)\.\s*/gm, '$1 ') 
  // 去除一行开头的圆点(*)，允许前面有空格
  .replace(/^\s*\*\s*/gm, '');
      this.textarea.value = cleanedText + "\n";
    };
    formatBtnRow.appendChild(clearFormatBtn);

    // 复制按钮
    const copyBtn = document.createElement("button");
    copyBtn.textContent = "复制";
    copyBtn.style.padding = "4px 8px";
    copyBtn.style.fontSize = "0.8em";
    copyBtn.style.marginRight = "8px";
    copyBtn.onclick = async () => {
      let textToCopy = "";
      const textarea = this.textarea;
      if (textarea.selectionStart !== textarea.selectionEnd) {
        textToCopy = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
      } else {
        textToCopy = textarea.value;
      }
      try {
        await navigator.clipboard.writeText(textToCopy);
        copyBtn.textContent = "已复制";
        setTimeout(() => { copyBtn.textContent = "复制"; }, 1200);
      } catch (err) {
        copyBtn.textContent = "失败";
        setTimeout(() => { copyBtn.textContent = "复制"; }, 1200);
      }
    };
    formatBtnRow.appendChild(copyBtn);

    // 插入到编辑器按钮
    const insertToEditorBtn = document.createElement("button");
    insertToEditorBtn.textContent = "插入";
    insertToEditorBtn.style.padding = "4px 8px";
    insertToEditorBtn.style.fontSize = "0.8em";
    insertToEditorBtn.style.marginRight = "8px";
    insertToEditorBtn.onclick = () => {
      const textToInsert = this.textarea.value;
      if (!textToInsert.trim()) {
        return;
      }
      
      // 获取当前编辑器
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView?.editor) {
        const editor = activeView.editor;
        
        try {
          // 优先检查是否有选中文本
          const selectedText = editor.getSelection();
          if (selectedText && selectedText.trim()) {
            // 如果有选中文本，获取选中文本的结束位置
            const endPos = editor.getCursor('to');
            
            // 在选中文本后面插入内容，另起一行
            editor.replaceRange("\n" + textToInsert, endPos);
          } else {
            // 如果没有选中文本，获取当前光标位置
            const cursor = editor.getCursor();
            
            // 在光标位置插入内容，另起一行
            editor.replaceRange("\n" + textToInsert, cursor);
          }
          
          // 显示成功提示
          insertToEditorBtn.textContent = "已插入";
          setTimeout(() => { insertToEditorBtn.textContent = "插入"; }, 1200);
        } catch (error) {
          console.error("插入内容失败:", error);
          // 备用方案：如果获取光标位置失败，则在文档末尾添加内容
          const lastLine = editor.lineCount() - 1;
          const lastLineEnd = editor.getLine(lastLine).length;
          editor.replaceRange("\n" + textToInsert, { line: lastLine, ch: lastLineEnd });
          
          insertToEditorBtn.textContent = "已添加到末尾";
          setTimeout(() => { insertToEditorBtn.textContent = "插入"; }, 1200);
        }
      }
    };
    formatBtnRow.appendChild(insertToEditorBtn);

    // 保存为文件按钮
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "保存";
    saveBtn.style.padding = "4px 8px";
    saveBtn.style.fontSize = "0.8em";
    saveBtn.style.marginRight = "8px";
    saveBtn.onclick = async () => {
      const text = this.textarea.value;
      if (!text.trim()) {
        return;
      }
      
      // 提取第一行或第二行作为标题
      const lines = text.trim().split('\n');
      let title = "AI回答";
      // 找到第一个非空行作为标题
      for (let i = 0; i < Math.min(lines.length, 2); i++) {
        const line = lines[i].trim();
        if (line) {
          // 移除Markdown标记
          title = line.replace(/^[#*>-]+\s*/, '').replace(/[*_`~]+/g, '');
          // 限制标题长度
          title = title.substring(0, 50);
          break;
        }
      }
      
      // 生成安全的文件名
      const safeTitle = title.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
      const fileName = safeTitle + ".md";
      
      try {
        // 使用Obsidian API保存文件到库的根目录
        await this.app.vault.create(fileName, text);
        saveBtn.textContent = "已保存";
        setTimeout(() => { saveBtn.textContent = "保存"; }, 1200);
      } catch (err) {
        console.error("保存文件失败:", err);
        saveBtn.textContent = "失败";
        setTimeout(() => { saveBtn.textContent = "保存"; }, 1200);
      }
    };
    formatBtnRow.appendChild(saveBtn);

    // 字体大小调整逻辑
    let fontSize = 14;
    this.textarea.style.fontSize = fontSize + "px";
    fontIncBtn.onclick = () => {
      fontSize = Math.min(fontSize + 2, 32);
      this.textarea.style.fontSize = fontSize + "px";
    };
    fontDecBtn.onclick = () => {
      fontSize = Math.max(fontSize - 2, 10);
      this.textarea.style.fontSize = fontSize + "px";
    };

    // 输入区和按钮区
  const inputRow = contentEl.createDiv();
  inputRow.addClass("ask-ai-input-row");
    inputRow.style.display = "flex";
    inputRow.style.gap = "8px";
    inputRow.style.marginTop = "10px";

    // 输入框
    // 编辑模式下使用textarea并设置为3行高度
    if (this._editMode) {
      this.inputField = inputRow.createEl("textarea");
      this.inputField.rows = "3";
      this.inputField.style.resize = "vertical";
    } else {
      this.inputField = inputRow.createEl("input");
      this.inputField.type = "text";
    }
    this.inputField.placeholder = "输入问题后按Ctrl+Enter发送";
    this.inputField.style.flex = "1";
    this.inputField.style.padding = "6px 8px";
    // 如果是编辑模式，预填内容并设置焦点到开头
    if (this._editMode) {
      this.inputField.value = this.query || "";
      // 在下一个事件循环中设置焦点以确保元素已完全渲染
      setTimeout(() => {
        if (this.inputField) {
          this.inputField.focus();
          this.inputField.setSelectionRange(0, 0);
          // 确保视图滚动到开头，解决长文本默认显示在末尾的问题
          this.inputField.scrollTop = 0;
        }
      }, 10);
    }

    // 继续提问按钮
    const continueBtn = inputRow.createEl("button", { text: "提问" });
    continueBtn.style.padding = "6px 12px";
    continueBtn.style.minWidth = "60px";    
    
    // 确保在编辑模式下显示下拉选框时能正确初始化（不自动应用默认模板）
    if (this._editMode && this.plugin.settings.promptTemplates && this.plugin.settings.promptTemplates.length > 0) {
      // 检查是否有保存的选中模板索引
      if (this.selectedPromptIndex !== undefined && this.selectedPromptIndex < this.plugin.settings.promptTemplates.length) {
        promptSelect.value = this.selectedPromptIndex;
      } else if (this.plugin.settings.defaultPromptIndex !== undefined) {
        // 设置默认选中项但不自动应用
        promptSelect.value = this.plugin.settings.defaultPromptIndex;
      }
    }
    this.inputField.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        if (e.shiftKey) {
          // Shift+Enter: 插入换行符
          return; // 不阻止默认行为，让浏览器正常插入换行符
        } else {
          // 普通Enter: 提交问题
          e.preventDefault();
          const newQuestion = this.inputField.value.trim();
          if (!newQuestion) return;
          this.messages.push({ role: "user", content: newQuestion });
          this.textarea.value += `

🙋 ${newQuestion}

🤖 `;
          this.inputField.value = "";
          header.setText("AI 回答中...");
          const api = this.plugin.settings.apis[
            this.apiIndex ?? this.plugin.settings.defaultApiIndex
          ];
          await this.streamApi(
            this.messages,
            api,
            this.textarea,
            header,
            newQuestion,
            this.editor,
            true
          );
          this.textarea.scrollTop = this.textarea.scrollHeight;
        }
      }
    });

    continueBtn.onclick = async () => {
      const newQuestion = this.inputField.value.trim();
      if (!newQuestion) return;
      this.messages.push({ role: "user", content: newQuestion });
      this.textarea.value += `\n\n🙋 ${newQuestion}\n\n🤖 `;
      this.inputField.value = "";
      header.setText("AI 回答中...");
      const api = this.plugin.settings.apis[
        this.apiIndex ?? this.plugin.settings.defaultApiIndex
      ];
      await this.streamApi(
        this.messages,
        api,
        this.textarea,
        header,
        newQuestion,
        this.editor,
        true
      );
      this.textarea.scrollTop = this.textarea.scrollHeight;
    };

    // 打开时先用选中内容问一次（编辑模式不自动发送）
    if (!this._editMode) {
      try {
        const api = this.plugin.settings.apis[
          this.apiIndex ?? this.plugin.settings.defaultApiIndex
        ];
        await this.streamApi(this.messages, api, this.textarea, header, this.query, this.editor, false);
      } catch (err) {
        header.setText("❌ 请求失败");
        // 使用更安全的方式更新textarea内容，确保不会覆盖用户编辑的内容
        const errorMessage = err.message || String(err);
        // 如果textarea为空，直接设置错误信息；否则追加错误信息
        if (!this.textarea.value.trim()) {
          this.textarea.value = errorMessage;
        } else {
          this.textarea.value += "\n\n" + errorMessage;
        }
      }
    }
  }

  async streamApi(messages, api, outputEl, headerEl, selection, editor, isFollowup = false) {
    if (!api || !api.key || !api.url) {
      outputEl.value += "\n❌ API 没有配置完整";
      return;
    }

    // 性能检测：记录请求开始时间
    const performanceStart = performance.now();
    console.log(`🚀 [${api.name}] API请求开始`, {
      api: api.name,
      model: api.model,
      url: api.url,
      timestamp: new Date().toISOString(),
      messagesCount: messages.length
    });

    // 添加请求延迟以避免429错误（特别是智谱API）
    if (api.name === "智谱") {
      const delayStart = performance.now();
      await new Promise(resolve => setTimeout(resolve, 2000)); // 智谱API延迟2秒
      const delayEnd = performance.now();
      console.log(`⏱️ [${api.name}] 请求延迟耗时`, {
        delay: `${(delayEnd - delayStart).toFixed(2)}ms`,
        expectedDelay: '2000ms'
      });
    } else {
      const delayStart = performance.now();
      await new Promise(resolve => setTimeout(resolve, 500)); // 其他API延迟0.5秒
      const delayEnd = performance.now();
      console.log(`⏱️ [${api.name}] 请求延迟耗时`, {
        delay: `${(delayEnd - delayStart).toFixed(2)}ms`,
        expectedDelay: '500ms'
      });
    }

    this.abortController = new AbortController();

  let newMessages;

    if (!isFollowup) {
      // 首次提问：基于选中内容生成 prompt
      let context = "";
      if (editor) {
        const cursor = editor.getCursor();
        const startLine = Math.max(0, cursor.line - 2);
        const endLine = Math.min(editor.lineCount() - 1, cursor.line + 2);
        for (let i = startLine; i <= endLine; i++) {
          context += editor.getLine(i) + "\n";
        }
      }

  // 优先使用从二级菜单选中的模板，如果没有则使用默认模板
  let prompt = "";
  if (this.selectedTemplate) {
    // 使用从二级菜单选中的模板，确保使用this.query（原始选中的文字）替换变量
    prompt = this.selectedTemplate.replace(/{{selection}}/g, this.query).replace(/{{context}}/g, context);
    // 如果模板不包含{{selection}}变量，但用户确实选中了文本，那么在模板后添加选中的文本
    if (!this.selectedTemplate.includes('{{selection}}') && this.query) {
      prompt += '\n' + this.query;
    }
  } else if (this.plugin.settings.promptTemplates && this.plugin.settings.promptTemplates.length > 0) {
    // 使用默认模板
    const defaultTemplate = this.plugin.settings.promptTemplates[this.plugin.settings.defaultPromptIndex || 0];
    prompt = defaultTemplate.template.replace(/{{selection}}/g, this.query).replace(/{{context}}/g, context);
    // 如果默认模板不包含{{selection}}变量，但用户确实选中了文本，那么在模板后添加选中的文本
    if (!defaultTemplate.template.includes('{{selection}}') && this.query) {
      prompt += '\n' + this.query;
    }
  }
  newMessages = [...messages, { role: "user", content: prompt }];
    } else {
      // 继续提问：直接用完整历史
      newMessages = [...messages];
    }

    // 性能检测：记录网络请求开始时间
    const fetchStart = performance.now();
    console.log(`🌐 [${api.name}] 发送网络请求`, {
      url: api.url,
      model: api.model || (api.name === "智谱" ? "glm-4-airx" : "moonshot-v1-32k"),
      messagesLength: JSON.stringify(newMessages).length,
      requestSize: `${Math.round(JSON.stringify(newMessages).length / 1024)}KB`
    });

    const resp = await fetch(api.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + api.key,
      },
      body: JSON.stringify({
        model: api.model || (api.name === "智谱" ? "glm-4-airx" : "moonshot-v1-32k"),
        stream: true,
        messages: newMessages,
      }),
      signal: this.abortController.signal,
    });

    const fetchEnd = performance.now();
    const fetchTime = fetchEnd - fetchStart;
    
    console.log(`📡 [${api.name}] 网络请求完成`, {
      fetchTime: `${fetchTime.toFixed(2)}ms`,
      status: resp.status,
      statusText: resp.statusText,
      headers: {
        contentType: resp.headers.get('content-type'),
        server: resp.headers.get('server'),
        date: resp.headers.get('date')
      }
    });

    if (!resp.ok || !resp.body) {
      console.error(`❌ [${api.name}] 请求失败`, {
        status: resp.status,
        statusText: resp.statusText,
        url: api.url,
        fetchTime: `${fetchTime.toFixed(2)}ms`
      });
      throw new Error(`HTTP 错误: ${resp.status}`);
    }

    headerEl.setText("AI 回答：");

    // 性能检测：记录流式响应开始时间
    const streamStart = performance.now();
    console.log(`📡 [${api.name}] 开始流式响应`, {
      timeSinceRequestStart: `${(streamStart - performanceStart).toFixed(2)}ms`,
      timeSinceFetchComplete: `${(streamStart - fetchEnd).toFixed(2)}ms`
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let fullAnswer = "";
    let firstChunkTime = null;
    let chunkCount = 0;
    let totalBytes = 0;

    while (true) {
      const chunkStart = performance.now();
      const { done, value } = await reader.read();
      
      if (done) {
        const streamEnd = performance.now();
        const totalStreamTime = streamEnd - streamStart;
        console.log(`🏁 [${api.name}] 流式响应结束`, {
          totalStreamTime: `${totalStreamTime.toFixed(2)}ms`,
          totalChunks: chunkCount,
          totalBytes: totalBytes,
          averageChunkTime: chunkCount > 0 ? `${(totalStreamTime / chunkCount).toFixed(2)}ms` : 'N/A',
          finalAnswerLength: fullAnswer.length,
          totalTime: `${(streamEnd - performanceStart).toFixed(2)}ms`
        });
        break;
      }
      
      // 记录第一个数据块的时间
      if (!firstChunkTime) {
        firstChunkTime = chunkStart;
        const firstChunkDelay = firstChunkTime - streamStart;
        console.log(`⚡ [${api.name}] 首个数据块到达`, {
          firstChunkDelay: `${firstChunkDelay.toFixed(2)}ms`,
          timeSinceRequestStart: `${(firstChunkTime - performanceStart).toFixed(2)}ms`,
          chunkSize: value.length
        });
      }
      
      buffer += decoder.decode(value, { stream: true });
      totalBytes += value.length;
      chunkCount++;

      const parts = buffer.split("\n\n");
      buffer = parts.pop();

      for (const part of parts) {
        if (part.startsWith("data: ")) {
          const data = part.slice(6).trim();
          if (data === "[DONE]") {
            const streamEnd = performance.now();
            const totalStreamTime = streamEnd - streamStart;
            console.log(`🏁 [${api.name}] 流式响应完成`, {
              totalStreamTime: `${totalStreamTime.toFixed(2)}ms`,
              totalChunks: chunkCount,
              totalBytes: totalBytes,
              averageChunkTime: chunkCount > 0 ? `${(totalStreamTime / chunkCount).toFixed(2)}ms` : 'N/A',
              finalAnswerLength: fullAnswer.length,
              totalTime: `${(streamEnd - performanceStart).toFixed(2)}ms`
            });
            
            this.messages.push({ role: "assistant", content: fullAnswer });
            
            // 检查是否启用了自动化模式
            if (this._autoMode && this.plugin.settings.autoModeScript) {
              // 延迟执行脚本，确保所有内容都已经显示在界面上
              setTimeout(() => {
                this.executeAutoModeScript();
              }, 100);
            }
            
            return;
          }
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content;
            
            // 智谱API特殊分析：检测空数据块
            if (api.name === "智谱") {
              if (chunkCount <= 50) { // 前50个数据块详细分析
                console.log(`🔍 [${api.name}] 数据块#${chunkCount}分析`, {
                  hasDelta: !!delta,
                  deltaLength: delta ? delta.length : 0,
                  deltaContent: delta ? JSON.stringify(delta) : 'null',
                  rawChoices: json.choices ? 'exists' : 'null',
                  choiceStructure: json.choices ? Object.keys(json.choices[0] || {}) : 'null'
                });
              }
              
              // 检测异常模式：连续空数据块
              if (!delta && chunkCount % 100 === 0) {
                console.warn(`⚠️ [${api.name}] 异常检测`, {
                  chunkNumber: chunkCount,
                  consecutiveEmptyChunks: '检测到大量空数据块',
                  efficiency: `${((fullAnswer.length / chunkCount) * 100).toFixed(4)}%`,
                  recommendation: '建议检查API响应格式或联系智谱技术支持'
                });
              }
            }
            
            if (delta) {
                // 使用更安全的方式更新textarea内容，确保不会覆盖用户编辑的内容
                const currentText = outputEl.value;
                outputEl.value = currentText + delta;
                fullAnswer += delta;
                
                // 每次更新内容后自动滚动到底部，无需用户手动滑动
                outputEl.scrollTop = outputEl.scrollHeight;
                
                // 每10个数据块记录一次性能信息
                if (chunkCount % 10 === 0) {
                const currentChunkTime = performance.now();
                console.log(`📊 [${api.name}] 流式响应进度`, {
                  chunkNumber: chunkCount,
                  currentAnswerLength: fullAnswer.length,
                  averageChunkSize: `${(totalBytes / chunkCount).toFixed(0)} bytes`,
                  chunksPerSecond: `${(chunkCount / ((currentChunkTime - streamStart) / 1000)).toFixed(2)}`,
                  timeElapsed: `${(currentChunkTime - streamStart).toFixed(2)}ms`,
                  efficiency: `${((fullAnswer.length / chunkCount) * 100).toFixed(4)}%`
                });
              }
            }
          } catch (e) {
            console.warn(`[${api.name}] 解析失败:`, part, e);
          }
        }
      }
    }
  }

  onClose() {
    this.contentEl.empty();
    if (this.modalEl) {
      this.modalEl.removeEventListener("mousedown", null);
    }
  }
  
  // 执行自动化模式脚本
  executeAutoModeScript() {
    const script = this.plugin.settings.autoModeScript || "";
    // 首先按行分割，然后处理每一行
    const lines = script.split('\n').map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('//'));
    
    // 再按分号分割，确保命令能被正确识别
    const commands = [];
    lines.forEach(line => {
      const cmds = line.split(';').map(cmd => cmd.trim()).filter(cmd => cmd.length > 0);
      // 只移除sleep命令的括号，保留其他命令的括号
      const cmdsWithoutParentheses = cmds.map(cmd => {
        if (cmd.toLowerCase().startsWith('sleep')) {
          return cmd.replace(/\([^)]*\)$/, '').trim();
        }
        return cmd;
      });
      commands.push(...cmdsWithoutParentheses);
    });
    
    let delay = 0;
    
    // 检查是否有明确的closeModal命令（只检查未注释的命令）
    const hasCloseModalCommand = commands.some(cmd => 
      cmd.toLowerCase().includes('closemodal') || cmd.toLowerCase().includes('关闭')
    );
    
    // 调试信息
    console.log('自动化脚本执行:', {
      originalScript: script,
      filteredLines: lines,
      commands: commands,
      hasCloseModalCommand: hasCloseModalCommand
    });
    
    // 遍历所有命令并添加延迟执行
    commands.forEach((cmd, index) => {
      delay += 100; // 每个命令之间有100ms的延迟，确保前一个命令执行完毕
      
      setTimeout(() => {
        console.log(`执行命令 [${index}/${commands.length}]:`, cmd);
        
        // 特殊处理：如果是closeModal命令，延迟到最后执行
        if (cmd.toLowerCase().includes('closemodal') || cmd.toLowerCase().includes('关闭')) {
          console.log('检测到closeModal命令，将延迟到最后执行');
          // 不立即执行closeModal，等待所有其他命令完成后再执行
          return;
        }
        
        // 特殊处理：如果是pressKey命令且存在closeModal命令，延迟到模态框关闭后执行
        if (cmd.toLowerCase().includes('presskey') && hasCloseModalCommand) {
          console.log('检测到pressKey命令且存在closeModal，将延迟到模态框关闭后执行');
          // 不立即执行pressKey，等待模态框关闭后再执行
          return;
        }
        
        this.executeScriptCommand(cmd);
        
        // 如果是最后一个命令且没有closeModal命令，自动关闭
        if (index === commands.length - 1 && !hasCloseModalCommand) {
          console.log('没有closeModal命令，将在1秒后自动关闭模态框');
          setTimeout(() => {
            this.close();
          }, 1000);
        }
      }, delay);
    });
    
    // 如果有closeModal命令，在所有其他命令执行完毕后执行
    if (hasCloseModalCommand) {
      // 计算所有命令执行完毕的时间，再加上额外延迟
      setTimeout(() => {
        console.log('所有命令执行完毕，现在关闭模态框');
        this.close();
        
        // 关闭模态框后，延迟执行pressKey命令
        setTimeout(() => {
          // 查找所有pressKey命令并在模态框关闭后执行
          commands.forEach((cmd, index) => {
            if (cmd.toLowerCase().includes('presskey')) {
              console.log(`模态框关闭后执行pressKey命令 [${index}]:`, cmd);
              this.executeScriptCommand(cmd);
            }
          });
        }, 300); // 模态框关闭后300ms执行pressKey
      }, delay + 500); // 额外500ms延迟确保最后一个命令完全执行完毕
    }
  }
  
  // 执行单个脚本命令
  executeScriptCommand(cmd) {
    const normalizedCmd = cmd.toLowerCase().trim();
    
    if (normalizedCmd.includes('自定义插入内容') || normalizedCmd.includes('insertcustomtext')) {
      // 查找并点击自定义插入内容按钮
      const formatRows = this.contentEl.querySelectorAll('.ask-ai-format-row');
      formatRows.forEach(row => {
        const buttons = row.querySelectorAll('button');
        buttons.forEach(button => {
          // 使用实际的按钮文本进行匹配，而不是硬编码的"自定义插入内容"
          const customTextName = this.plugin?.settings?.customTextName || "自定义文本";
          if (button.textContent.includes(customTextName)) {
            button.click();
          }
        });
      });
    } 
    else if (normalizedCmd.includes('清除格式') || normalizedCmd.includes('clearformat')) {
      // 查找并点击清除格式按钮
      const formatRows = this.contentEl.querySelectorAll('.ask-ai-format-row');
      formatRows.forEach(row => {
        const buttons = row.querySelectorAll('button');
        buttons.forEach(button => {
          if (button.textContent.includes('清除格式')) {
            button.click();
          }
        });
      });
    } 
    else if (normalizedCmd.includes('插入') || normalizedCmd.includes('insert') || normalizedCmd.includes('inserttoeditor')) {
      // 查找并点击插入到编辑器按钮
      const formatRows = this.contentEl.querySelectorAll('.ask-ai-format-row');
      formatRows.forEach(row => {
        const buttons = row.querySelectorAll('button');
        buttons.forEach(button => {
          // 精确匹配"插入"按钮，避免匹配到其他包含"插入"文字的按钮
          if (button.textContent === '插入') {
            button.click();
          }
        });
      });
    }
    else if (normalizedCmd.includes('复制') || normalizedCmd.includes('copy')) {
      // 查找并点击复制按钮
      const formatRows = this.contentEl.querySelectorAll('.ask-ai-format-row');
      formatRows.forEach(row => {
        const buttons = row.querySelectorAll('button');
        buttons.forEach(button => {
          if (button.textContent.includes('复制')) {
            button.click();
          }
        });
      });
    }
    else if (normalizedCmd.includes('关闭') || normalizedCmd.includes('closemodal')) {
      // 关闭模态框
      this.close();
    }
    // 新增：模拟键盘快捷键命令
    else if (normalizedCmd.includes('presskey')) {
      try {
        console.log('尝试解析pressKey命令:', cmd);
        
        // 解析命令参数，格式：pressKey(key, alt?, ctrl?, shift?, meta?)
        // 修复：使用原始命令而不是规范化后的命令进行匹配
        const paramMatch = cmd.match(/presskey\(([^)]+)\)/i);
        if (paramMatch && paramMatch[1]) {
          console.log('pressKey参数匹配成功:', paramMatch[1]);
          const params = paramMatch[1].split(',').map(p => p.trim());
          console.log('解析的参数:', params);
          
          const key = params[0].replace(/['"]/g, ''); // 移除引号
          const alt = params.length > 1 ? params[1].toLowerCase() === 'true' : false;
          const ctrl = params.length > 2 ? params[2].toLowerCase() === 'true' : false;
          const shift = params.length > 3 ? params[3].toLowerCase() === 'true' : false;
          const meta = params.length > 4 ? params[4].toLowerCase() === 'true' : false;
          
          console.log('模拟键盘事件:', { key, alt, ctrl, shift, meta });
          
          // 模拟键盘事件
          this.simulateKeyboardEvent(key, alt, ctrl, shift, meta);
        } else {
          console.warn('pressKey参数匹配失败，命令格式不正确:', cmd);
        }
      } catch (error) {
        console.error('执行pressKey命令失败:', error);
      }
    }
    
    // 可以添加更多命令支持...
  }
  
  // 模拟键盘事件的辅助方法
  simulateKeyboardEvent(key, altKey, ctrlKey, shiftKey, metaKey) {
    try {
      // 创建键盘事件配置
      const eventConfig = {
        key: key,
        code: key.length === 1 && /[a-zA-Z]/.test(key) ? 'Key' + key.toUpperCase() : 
              key.length === 1 && /[0-9]/.test(key) ? 'Digit' + key : key,
        altKey: altKey,
        ctrlKey: ctrlKey,
        shiftKey: shiftKey,
        metaKey: metaKey,
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        repeat: false,
        isComposing: false
      };
      
      // 只向当前活动元素分发事件，避免多次执行
      const target = document.activeElement || document.body;
      
      // 保存当前文本选择状态
      let selection = window.getSelection();
      let selectionRange = null;
      if (selection && !selection.isCollapsed) {
        selectionRange = selection.getRangeAt(0);
      }
      
      // 模拟按键过程：keydown -> keyup
      setTimeout(() => {
        try {
          // 分发keydown事件
          const keydownEvent = new KeyboardEvent('keydown', eventConfig);
          target.dispatchEvent(keydownEvent);
          
          // 添加小延迟后分发keyup事件
          setTimeout(() => {
            try {
              const keyupEvent = new KeyboardEvent('keyup', eventConfig);
              target.dispatchEvent(keyupEvent);
            } catch (e) {
              console.error('分发keyup事件失败:', e);
            }
          }, 10);
        } catch (eventError) {
          console.error('模拟键盘事件失败:', eventError);
        }
      }, 5);
      
      console.log(`模拟键盘快捷键: ${altKey ? 'Alt+' : ''}${ctrlKey ? 'Ctrl+' : ''}${shiftKey ? 'Shift+' : ''}${metaKey ? 'Meta+' : ''}${key}`);
    } catch (error) {
      console.error('模拟键盘事件时发生错误:', error);
    }
  }
}

class InputModal extends Modal {
  constructor(app, placeholder, onSubmit) {
    super(app);
    this.placeholder = placeholder;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "继续提问" });

    const input = contentEl.createEl("input", {
      type: "text",
      placeholder: this.placeholder || "请输入你的问题...",
    });
    input.style.width = "100%";
    input.style.marginBottom = "10px";

    const submitBtn = contentEl.createEl("button", { text: "发送" });
    submitBtn.onclick = () => {
      const value = input.value.trim();
      if (value) {
        this.close();
        this.onSubmit(value);
      }
    };

    // 回车提交
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        submitBtn.click();
      }
    });

    input.focus();
  }

  onClose() {
    this.contentEl.empty();
  }
}


class AskAiSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    

    // 标题
    containerEl.createEl("h2", { text: "⚙️ Ask AI 设置" });
    containerEl.createEl("p", {
     // text: "在这里配置多个 API，并选择一个默认 API 用于请求。",
      cls: "setting-item-description",
    });

    // Prompt模板设置 - 支持多个模板
    containerEl.createEl("h3", { text: "📝 Prompt模板管理" });
    
    // 模板列表容器
    const templateContainer = containerEl.createDiv();
    templateContainer.style.marginBottom = "20px";
    templateContainer.style.width = "100%";
    templateContainer.style.boxSizing = "border-box";
    
    // 渲染模板列表
    const renderTemplates = () => {
      templateContainer.empty();
      
      // 保存外部的this上下文，以便在事件处理函数中使用
      const that = this;
      
      if (!this.plugin.settings.promptTemplates || this.plugin.settings.promptTemplates.length === 0) {
        templateContainer.createEl("p", { 
          text: "暂无模板，请添加一个新模板", 
          cls: "setting-item-description"
        });
        return;
      }
      
      this.plugin.settings.promptTemplates.forEach((template, index) => {
        const templateItem = templateContainer.createDiv("setting-item");
        templateItem.style.padding = "10px";
        templateItem.style.border = "1px solid #ddd";
        templateItem.style.borderRadius = "5px";
        templateItem.style.marginBottom = "10px";
        templateItem.style.backgroundColor = index === this.plugin.settings.defaultPromptIndex ? "#f0f7ff" : "";
        templateItem.style.width = "100%";
        templateItem.style.boxSizing = "border-box";
        
        // 创建一个新的布局，将按钮放在左侧，编辑框挨着按钮
        const templateLayout = templateItem.createDiv();
        templateLayout.style.display = "flex";
        templateLayout.style.alignItems = "center"; // 设置为垂直居中对齐
        templateLayout.style.gap = "10px";
        templateLayout.style.width = "100%";
        
        // 左侧按钮区域
        const buttonContainer = templateLayout.createDiv();
        buttonContainer.style.display = "flex";
        buttonContainer.style.flexDirection = "column";
        buttonContainer.style.gap = "4px";
        buttonContainer.style.minWidth = "60px";
        buttonContainer.style.justifyContent = "center"; // 按钮在容器内垂直居中
        
        // 添加"默认"按钮，替代原有的标记和按钮
        const setDefaultBtn = buttonContainer.createEl("button", { text: "默认" });
        setDefaultBtn.style.padding = "2px 6px";
        setDefaultBtn.style.fontSize = "0.8em";
        
        if (index === this.plugin.settings.defaultPromptIndex) {
          // 默认模板的按钮：不可点击，改变颜色
          setDefaultBtn.disabled = true;
          setDefaultBtn.style.opacity = "1";
          setDefaultBtn.style.color = "var(--interactive-accent)";
          setDefaultBtn.style.cursor = "default";
          setDefaultBtn.style.fontWeight = "bold";
        } else {
          // 非默认模板的按钮：保持原有功能
          setDefaultBtn.onclick = async () => {
            this.plugin.settings.defaultPromptIndex = index;
            await this.plugin.saveSettings();
            renderTemplates();
          };
        }
        
        // 删除按钮已被移除，改用失焦时自动删除空内容模板的方式
        
        // 编辑框区域 - 挨着按钮，占据剩余空间
        const textareaWrapper = templateLayout.createDiv();
        textareaWrapper.style.flexGrow = "1"; // 占据剩余空间
        textareaWrapper.style.width = "100%";
        textareaWrapper.style.minWidth = "400px"; // 增加最小宽度，确保编辑框足够宽
        textareaWrapper.style.boxSizing = "border-box";
        
        // 直接使用可编辑的textarea显示和编辑模板内容
        const templateTextArea = textareaWrapper.createEl("textarea");
        templateTextArea.value = template.template;
        templateTextArea.style.width = "100%";
        templateTextArea.style.minWidth = "300px"; // 设置最小宽度，确保编辑框不会太窄
        templateTextArea.style.fontSize = "1em";
        templateTextArea.style.lineHeight = "1.5";
        templateTextArea.style.resize = "none"; // 禁用手动调整大小，使用自动调整
        templateTextArea.style.boxSizing = "border-box";
        templateTextArea.style.overflow = "hidden"; // 隐藏滚动条
        templateTextArea.style.display = "block"; // 确保作为块级元素渲染
        
        // 使用多个setTimeout确保在不同阶段都能保持宽度稳定
        setTimeout(() => {
          textareaWrapper.style.width = "100%";
          templateTextArea.style.width = "100%";
          adjustTextareaHeight(templateTextArea);
        }, 0);
        
        // 额外的延迟确保完全渲染后再次确认宽度
        setTimeout(() => {
          templateTextArea.style.width = "100%";
        }, 10);
        
        // 自动调整textarea高度的函数
        const adjustTextareaHeight = (textarea) => {
          textarea.style.height = "auto"; // 重置高度
          const newHeight = Math.max(60, textarea.scrollHeight); // 设置最小高度60px
          textarea.style.height = newHeight + "px";
        };
        
        // 初始化时调整高度
        adjustTextareaHeight(templateTextArea);
        
        // 内容变化时调整高度并保存
        templateTextArea.oninput = async () => {
          adjustTextareaHeight(templateTextArea);
          try {
            this.plugin.settings.promptTemplates[index].template = templateTextArea.value;
            // 保持数据结构兼容性，仍然需要name属性，但我们可以使用模板的第一行作为name
            const firstLine = templateTextArea.value.split('\n')[0] || "模板";
            this.plugin.settings.promptTemplates[index].name = firstLine;
            await this.plugin.saveSettings();
          } catch (error) {
            console.error("保存模板内容失败:", error);
          }
        };
        
        // 修复删除模板后焦点问题 - 确保可以正常获取焦点
        // 添加：当编辑框失去焦点且内容为空时自动删除这个模板
        templateTextArea.onblur = async function() {
          // 确保失去焦点时不会阻止后续的焦点获取
          setTimeout(() => {
            this.style.outline = "none"; // 移除默认轮廓以使用自定义样式
          }, 0);
          
          // 检查内容是否为空且不是默认模板
          if (!this.value.trim() && index !== that.plugin.settings.defaultPromptIndex && that.plugin.settings.promptTemplates.length > 1) {
            try {
              that.plugin.settings.promptTemplates.splice(index, 1);
              // 如果被删除的是默认模板，设置新的默认模板
              if (that.plugin.settings.defaultPromptIndex === index) {
                that.plugin.settings.defaultPromptIndex = 0;
              }
              await that.plugin.saveSettings();
              
              // 使用setTimeout确保DOM更新完成后再重新渲染
              setTimeout(() => {
                renderTemplates();
              }, 0);
            } catch (error) {
              console.error("自动删除空模板失败:", error);
            }
          }
        };
        
        templateTextArea.onfocus = function() {
          this.style.outline = "2px solid var(--interactive-accent)"; // 自定义焦点样式
        };
      });
    };
    
    // 添加新模板按钮
    const addTemplateBtn = containerEl.createEl("button", { text: "➕ 添加新模板" });
    addTemplateBtn.style.padding = "8px 16px";
    addTemplateBtn.style.marginBottom = "20px";
    addTemplateBtn.onclick = async function() {
      try {
        // 确保promptTemplates数组存在
        if (!this.plugin.settings.promptTemplates) {
          this.plugin.settings.promptTemplates = [];
        }
        
        // 空模板内容
        const defaultTemplate = "";
        // 使用固定名称"新模板"
        const name = "新模板";
        
        // 添加新模板到设置中
        this.plugin.settings.promptTemplates.push({ name, template: defaultTemplate });
        await this.plugin.saveSettings();
        
        // 重新渲染模板列表，显示新增的模板
        renderTemplates();
        
        // 自动聚焦到新添加的模板的textarea
        const templateItems = templateContainer.querySelectorAll(".setting-item");
        if (templateItems.length > 0) {
          const newTemplateItem = templateItems[templateItems.length - 1];
          const textarea = newTemplateItem.querySelector("textarea");
          if (textarea) {
            textarea.focus();
          }
        }
      } catch (error) {
        console.error("添加新模板失败:", error);
        alert("添加新模板失败: " + error.message);
      }
    }.bind(this);
    
    // 渲染模板列表
    renderTemplates();
    
    // 字体设置
    new Setting(containerEl)
      .setName("AI回答字体")
      .setDesc("输入字体名称，如 'Microsoft YaHei', 'Arial', 'SimSun' 等。留空为默认字体。")
      .addText(text => {
        text.setValue(this.plugin.settings.defaultFontFamily || "");
        text.onChange(async (value) => {
          this.plugin.settings.defaultFontFamily = value;
          await this.plugin.saveSettings();
        });
      });
    
    // 悬浮球中键点击快捷键设置
    const shortcutRowContainer = containerEl.createDiv("setting-item");
    shortcutRowContainer.style.display = "flex";
    shortcutRowContainer.style.alignItems = "center";
    shortcutRowContainer.style.gap = "12px";
    shortcutRowContainer.style.padding = "8px 0";
    
    // 标题
    shortcutRowContainer.createEl("div", { text: "中键点击悬浮球执行按键:", cls: "setting-item-name" });
    
    // 创建修饰键开关函数
    const createModifierToggle = (name, settingKey) => {
      const toggleContainer = shortcutRowContainer.createDiv();
      toggleContainer.style.display = "flex";
      toggleContainer.style.alignItems = "center";
      toggleContainer.style.gap = "6px";
      
      toggleContainer.createEl("span", { text: name });
      const toggle = toggleContainer.createEl("input", { type: "checkbox" });
      toggle.checked = this.plugin.settings[settingKey] === true;
      toggle.style.cursor = "pointer";
      toggle.addEventListener("change", async (e) => {
        this.plugin.settings[settingKey] = e.target.checked;
        await this.plugin.saveSettings();
      });
    };
    
    // 创建各个修饰键开关
    createModifierToggle("Alt", "middleClickShortcutAlt");
    createModifierToggle("Ctrl", "middleClickShortcutCtrl");
    createModifierToggle("Shift", "middleClickShortcutShift");
    createModifierToggle("Win", "middleClickShortcutMeta");
    
    // 主要按键设置
    const keyInput = shortcutRowContainer.createEl("input", { type: "text", value: this.plugin.settings.middleClickShortcutKey || "a" });
    keyInput.style.width = "60px";
    keyInput.style.padding = "4px 8px";
    keyInput.style.borderRadius = "4px";
    keyInput.style.border = "1px solid var(--background-modifier-border)";
    keyInput.style.backgroundColor = "var(--background-secondary)";
    keyInput.style.color = "var(--text-normal)";
    keyInput.maxLength = 1;
    keyInput.addEventListener("change", async (e) => {
      const value = e.target.value;
      // 仅允许单个字母或数字
      if (value && value.length === 1 && /[a-zA-Z0-9]/.test(value)) {
        this.plugin.settings.middleClickShortcutKey = value.toLowerCase();
        await this.plugin.saveSettings();
      } else if (value === "") {
        this.plugin.settings.middleClickShortcutKey = "a";
        await this.plugin.saveSettings();
        keyInput.value = "a";
      } else {
        keyInput.value = this.plugin.settings.middleClickShortcutKey || "a";
      }
    });
    
    // 功能说明
    containerEl.createEl("div", {
      text: "💡 点击悬浮球中键时将触发您配置的系统快捷键组合。\n这允许您在其他应用程序中设置对应的快捷键操作。",
      cls: "setting-item"
    });
    containerEl.querySelector(".setting-item:last-child").style.padding = "12px";
    containerEl.querySelector(".setting-item:last-child").style.borderRadius = "8px";
    containerEl.querySelector(".setting-item:last-child").style.backgroundColor = "var(--background-secondary)";
    containerEl.querySelector(".setting-item:last-child").style.whiteSpace = "pre-line";
    containerEl.querySelector(".setting-item:last-child").style.marginBottom = "16px";

    // 自定义快捷键设置行
    const customShortcutRowContainer = containerEl.createDiv("setting-item");
    customShortcutRowContainer.style.display = "flex";
    customShortcutRowContainer.style.flexWrap = "wrap";
    customShortcutRowContainer.style.alignItems = "center";
    customShortcutRowContainer.style.gap = "12px";
    customShortcutRowContainer.style.padding = "8px 0";
    
    // 标题
    customShortcutRowContainer.createEl("div", { text: "悬浮球二级选项快捷键名称:", cls: "setting-item-name" });
    
    // 名称输入框
    const customNameInput = customShortcutRowContainer.createEl("input", { type: "text", value: this.plugin.settings.customShortcutName || "自定义快捷键" });
    customNameInput.style.width = "150px";
    customNameInput.style.padding = "4px 8px";
    customNameInput.style.borderRadius = "4px";
    customNameInput.style.border = "1px solid var(--background-modifier-border)";
    customNameInput.style.backgroundColor = "var(--background-secondary)";
    customNameInput.style.color = "var(--text-normal)";
    customNameInput.addEventListener("change", async (e) => {
      this.plugin.settings.customShortcutName = e.target.value || "自定义快捷键";
      await this.plugin.saveSettings();
    });
    
    // 创建自定义快捷键的修饰键开关（带容器参数）
    const createCustomModifierToggle = (name, settingKey) => {
      const toggleContainer = customShortcutRowContainer.createDiv();
      toggleContainer.style.display = "flex";
      toggleContainer.style.alignItems = "center";
      toggleContainer.style.gap = "6px";
      
      toggleContainer.createEl("span", { text: name });
      const toggle = toggleContainer.createEl("input", { type: "checkbox" });
      toggle.checked = this.plugin.settings[settingKey] === true;
      toggle.style.cursor = "pointer";
      toggle.addEventListener("change", async (e) => {
        this.plugin.settings[settingKey] = e.target.checked;
        await this.plugin.saveSettings();
      });
    };
    
    // 创建自定义快捷键的修饰键开关
    createCustomModifierToggle("Alt", "customShortcutAlt");
    createCustomModifierToggle("Ctrl", "customShortcutCtrl");
    createCustomModifierToggle("Shift", "customShortcutShift");
    createCustomModifierToggle("Win", "customShortcutMeta");
    
    // 主要按键设置
    const customKeyInput = customShortcutRowContainer.createEl("input", { type: "text", value: this.plugin.settings.customShortcutKey || "b" });
    customKeyInput.style.width = "60px";
    customKeyInput.style.padding = "4px 8px";
    customKeyInput.style.borderRadius = "4px";
    customKeyInput.style.border = "1px solid var(--background-modifier-border)";
    customKeyInput.style.backgroundColor = "var(--background-secondary)";
    customKeyInput.style.color = "var(--text-normal)";
    customKeyInput.maxLength = 1;
    customKeyInput.addEventListener("change", async (e) => {
      const value = e.target.value;
      // 仅允许单个字母或数字
      if (value && value.length === 1 && /[a-zA-Z0-9]/.test(value)) {
        this.plugin.settings.customShortcutKey = value.toLowerCase();
        await this.plugin.saveSettings();
      } else if (value === "") {
        this.plugin.settings.customShortcutKey = "b";
        await this.plugin.saveSettings();
        customKeyInput.value = "b";
      } else {
        customKeyInput.value = this.plugin.settings.customShortcutKey || "b";
      }
    });
    
    // 功能说明
    containerEl.createEl("div", {
      text: "💡 悬浮球菜单中将显示您设置的自定义快捷键名称，点击后执行配置的快捷键组合。",
      cls: "setting-item"
    });
    containerEl.querySelector(".setting-item:last-child").style.padding = "12px";
    containerEl.querySelector(".setting-item:last-child").style.borderRadius = "8px";
    containerEl.querySelector(".setting-item:last-child").style.backgroundColor = "var(--background-secondary)";
    containerEl.querySelector(".setting-item:last-child").style.whiteSpace = "pre-line";
    containerEl.querySelector(".setting-item:last-child").style.marginBottom = "16px";
    
    // 自定义文本设置
    containerEl.createEl("h3", { text: "📝 自定义文本设置" });
    
    // 自定义文本名称设置
    new Setting(containerEl)
      .setName("弹窗中插入自定义文本按钮名称")
      .setDesc("设置插入自定义文本按钮的显示名称")
      .addText(text => {
        text.setValue(this.plugin.settings.customTextName || "自定义文本");
        text.onChange(async (value) => {
          this.plugin.settings.customTextName = value || "自定义文本";
          await this.plugin.saveSettings();
        });
      });
    
    // 自定义文本内容设置
    const customTextContainer = containerEl.createDiv("setting-item");
    customTextContainer.style.marginBottom = "20px";
    customTextContainer.createEl("div", {
      text: "自定义插入内容",
      cls: "setting-item-name"
    });
    customTextContainer.createEl("div", {
      text: "设置点击按钮时插入的文本内容，{{selection}} 为选中的文本 {{modelname}}为当前模型名称。",

      cls: "setting-item-description"
    });
    const customTextTextarea = customTextContainer.createEl("textarea");
    customTextTextarea.value = this.plugin.settings.customTextContent || ">[!{{selection}}]\n";
    customTextTextarea.style.width = "100%";
    customTextTextarea.style.minHeight = "80px";
    customTextTextarea.style.marginTop = "8px";
    customTextTextarea.style.padding = "8px";
    customTextTextarea.style.borderRadius = "4px";
    customTextTextarea.style.border = "1px solid var(--background-modifier-border)";
    customTextTextarea.style.backgroundColor = "var(--background-secondary)";
    customTextTextarea.style.color = "var(--text-normal)";
    customTextTextarea.style.fontFamily = "var(--font-mono)";
    customTextTextarea.style.resize = "vertical";
    
    customTextTextarea.addEventListener("change", async (e) => {
      this.plugin.settings.customTextContent = e.target.value || ">[!{{selection}}]\n";
      await this.plugin.saveSettings();
    });

    // 自动化模式设置
    containerEl.createEl("h3", { text: "🤖 自动化" });
    const autoModeContainer = containerEl.createDiv();
    autoModeContainer.style.marginBottom = "20px";
    
    // 快捷键设置
    const autoModeShortcutRow = autoModeContainer.createDiv("setting-item");
    autoModeShortcutRow.style.display = "flex";
    autoModeShortcutRow.style.alignItems = "center";
    autoModeShortcutRow.style.gap = "12px";
    autoModeShortcutRow.style.padding = "8px 0";
    
    autoModeShortcutRow.createEl("div", {
      text: "自动化快捷键:",
      cls: "setting-item-name"
    });
    
    // 修饰键
    const autoModeModifiers = autoModeShortcutRow.createDiv();
    autoModeModifiers.style.display = "flex";
    autoModeModifiers.style.gap = "8px";
    autoModeModifiers.style.alignItems = "center";
    
    const autoModeAlt = autoModeModifiers.createEl("label", {
      text: "Alt"
    });
    autoModeAlt.style.display = "flex";
    autoModeAlt.style.alignItems = "center";
    autoModeAlt.style.gap = "4px";
    autoModeAlt.style.cursor = "pointer";
    
    const autoModeAltCheckbox = autoModeAlt.createEl("input");
    autoModeAltCheckbox.type = "checkbox";
    autoModeAltCheckbox.checked = this.plugin.settings.autoModeShortcutAlt || false;
    autoModeAltCheckbox.onchange = async (e) => {
      this.plugin.settings.autoModeShortcutAlt = e.target.checked;
      await this.plugin.saveSettings();
    };
    
    const autoModeCtrl = autoModeModifiers.createEl("label", {
      text: "Ctrl"
    });
    autoModeCtrl.style.display = "flex";
    autoModeCtrl.style.alignItems = "center";
    autoModeCtrl.style.gap = "4px";
    autoModeCtrl.style.cursor = "pointer";
    
    const autoModeCtrlCheckbox = autoModeCtrl.createEl("input");
    autoModeCtrlCheckbox.type = "checkbox";
    autoModeCtrlCheckbox.checked = this.plugin.settings.autoModeShortcutCtrl || false;
    autoModeCtrlCheckbox.onchange = async (e) => {
      this.plugin.settings.autoModeShortcutCtrl = e.target.checked;
      await this.plugin.saveSettings();
    };
    
    const autoModeShift = autoModeModifiers.createEl("label", {
      text: "Shift"
    });
    autoModeShift.style.display = "flex";
    autoModeShift.style.alignItems = "center";
    autoModeShift.style.gap = "4px";
    autoModeShift.style.cursor = "pointer";
    
    const autoModeShiftCheckbox = autoModeShift.createEl("input");
    autoModeShiftCheckbox.type = "checkbox";
    autoModeShiftCheckbox.checked = this.plugin.settings.autoModeShortcutShift || false;
    autoModeShiftCheckbox.onchange = async (e) => {
      this.plugin.settings.autoModeShortcutShift = e.target.checked;
      await this.plugin.saveSettings();
    };
    
    const autoModeMeta = autoModeModifiers.createEl("label", {
      text: "Meta"
    });
    autoModeMeta.style.display = "flex";
    autoModeMeta.style.alignItems = "center";
    autoModeMeta.style.gap = "4px";
    autoModeMeta.style.cursor = "pointer";
    
    const autoModeMetaCheckbox = autoModeMeta.createEl("input");
    autoModeMetaCheckbox.type = "checkbox";
    autoModeMetaCheckbox.checked = this.plugin.settings.autoModeShortcutMeta || false;
    autoModeMetaCheckbox.onchange = async (e) => {
      this.plugin.settings.autoModeShortcutMeta = e.target.checked;
      await this.plugin.saveSettings();
    };
    
    // 快捷键捕获
    const autoModeKeyCapture = autoModeShortcutRow.createEl("button");
    autoModeKeyCapture.className = "mod-cta";
    autoModeKeyCapture.textContent = this.plugin.settings.autoModeShortcutKey || "未设置";
    autoModeKeyCapture.style.minWidth = "80px";
    autoModeKeyCapture.onclick = () => {
      autoModeKeyCapture.classList.add("is-capturing");
      autoModeKeyCapture.textContent = "按任意键";
      
      const captureKey = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        this.plugin.settings.autoModeShortcutKey = e.key;
        autoModeKeyCapture.textContent = e.key.toUpperCase();
        autoModeKeyCapture.classList.remove("is-capturing");
        
        document.removeEventListener("keydown", captureKey);
        this.plugin.saveSettings();
      };
      
      document.addEventListener("keydown", captureKey, { once: true });
    };
    
    // 脚本设置
    const scriptContainer = autoModeContainer.createDiv();
    scriptContainer.style.marginTop = "16px";
    scriptContainer.createEl("div", {
      text: "自动化脚本:",
      cls: "setting-item-name"
    });
    scriptContainer.createEl("div", {
      text: "配置AI回复完成后要执行的操作序列，支持: insertCustomText()、clearFormat()、copy()、insertToEditor()、closeModal()、pressKey(key,alt?,ctrl?,shift?,meta?)",
      cls: "setting-item-description"
    });
    
    scriptContainer.createEl("div", {
      text: "pressKey命令格式: pressKey('key', altKey, ctrlKey, shiftKey, metaKey) - 模拟键盘快捷键，例如 pressKey('s', true, true) 表示Alt+Ctrl+S",
      cls: "setting-item-description"
    });
    
    const scriptTextarea = scriptContainer.createEl("textarea");
    scriptTextarea.value = this.plugin.settings.autoModeScript || "// 自动化脚本示例\ninsertCustomText()\nclearFormat()\n// insertToEditor()  // 将AI回复插入到编辑器中\n// copy()\n// pressKey('s', true, true)  // 模拟按下Alt+Ctrl+S快捷键\ncloseModal()";
    scriptTextarea.style.width = "100%";
    scriptTextarea.style.minHeight = "120px";
    scriptTextarea.style.marginTop = "8px";
    scriptTextarea.style.padding = "8px";
    scriptTextarea.style.borderRadius = "4px";
    scriptTextarea.style.border = "1px solid var(--background-modifier-border)";
    scriptTextarea.style.backgroundColor = "var(--background-secondary)";
    scriptTextarea.style.color = "var(--text-normal)";
    scriptTextarea.style.fontFamily = "var(--font-mono)";
    scriptTextarea.style.resize = "vertical";
    
    scriptTextarea.addEventListener("change", async (e) => {
      this.plugin.settings.autoModeScript = e.target.value;
      await this.plugin.saveSettings();
    });

    // API 设置部分 - 压缩布局
    const apiSection = containerEl.createDiv("ask-ai-api-section");
    apiSection.createEl("h3", { text: "🔗 API 配置" });
    
    // 每个 API 用紧凑的卡片包装
    this.plugin.settings.apis.forEach((api, index) => {
      const card = apiSection.createDiv("ask-ai-card compact");
      if (index === this.plugin.settings.defaultApiIndex) {
        card.addClass("is-default");
      }
      
      // 标题行
      const titleRow = card.createDiv("ask-ai-card-header");
      const title = titleRow.createEl("h4", {
        text: api.name || `API ${index + 1}`,
        cls: "ask-ai-card-title",
      });
      
      // 紧凑的表单布局 - 一行显示四个字段
      const formRow = card.createDiv("ask-ai-form-row");
      
      // 名称字段
      const nameGroup = formRow.createDiv("ask-ai-field-group");
      const nameLabel = nameGroup.createEl("label", { text: "名称", cls: "ask-ai-field-label" });
      nameLabel.style.marginBottom = "2px";
      const nameInput = nameGroup.createEl("input", { type: "text" });
      nameInput.placeholder = "名称";
      nameInput.value = api.name || "";
      nameInput.className = "ask-ai-field-input";
      nameInput.addEventListener("change", async (value) => {
        api.name = value.target.value;
        await this.plugin.saveSettings();
        this.display();
      });
      
      // 地址字段
      const urlGroup = formRow.createDiv("ask-ai-field-group");
      const urlLabel = urlGroup.createEl("label", { text: "地址", cls: "ask-ai-field-label" });
      urlLabel.style.marginBottom = "2px";
      const urlInput = urlGroup.createEl("input", { type: "text" });
      urlInput.placeholder = "地址";
      urlInput.value = api.url || "";
      urlInput.className = "ask-ai-field-input";
      urlInput.addEventListener("change", async (value) => {
        api.url = value.target.value;
        await this.plugin.saveSettings();
      });
      
      // 密钥字段
      const keyGroup = formRow.createDiv("ask-ai-field-group");
      const keyLabel = keyGroup.createEl("label", { text: "密钥", cls: "ask-ai-field-label" });
      keyLabel.style.marginBottom = "2px";
      const keyInput = keyGroup.createEl("input", { type: "password" });
      keyInput.placeholder = "密钥";
      keyInput.value = api.key || "";
      keyInput.className = "ask-ai-field-input";
      keyInput.addEventListener("change", async (value) => {
        api.key = value.target.value;
        await this.plugin.saveSettings();
      });
      
      // 模型字段
      const modelGroup = formRow.createDiv("ask-ai-field-group");
      const modelLabel = modelGroup.createEl("label", { text: "模型", cls: "ask-ai-field-label" });
      modelLabel.style.marginBottom = "2px";
      const modelInput = modelGroup.createEl("input", { type: "text" });
      modelInput.placeholder = "模型";
      modelInput.value = api.model || "";
      modelInput.className = "ask-ai-field-input";
      modelInput.addEventListener("change", async (value) => {
        api.model = value.target.value;
        await this.plugin.saveSettings();
      });
      
      // 紧凑的按钮行
      const buttonRow = card.createDiv("ask-ai-buttons compact");
      const defaultBtn = buttonRow.createEl("button", { text: "默认" });
      defaultBtn.className = "mod-cta";
      defaultBtn.onclick = async () => {
        this.plugin.settings.defaultApiIndex = index;
        await this.plugin.saveSettings();
        new Notice(`已将 ${api.name || "API " + (index + 1)} 设为默认`);
        this.display();
      };
      const deleteBtn = buttonRow.createEl("button", { text: "删除" });
      deleteBtn.className = "mod-warning";
      deleteBtn.onclick = async () => {
        this.plugin.settings.apis.splice(index, 1);
        await this.plugin.saveSettings();
        new Notice(`已删除 ${api.name || "API " + (index + 1)}`);
        this.display();
        if (this.plugin.settings.defaultApiIndex >= this.plugin.settings.apis.length) {
          this.plugin.settings.defaultApiIndex = 0;
        }
        await this.plugin.saveSettings();
        this.display();
      };
    });

    // 添加按钮
    const addRow = containerEl.createDiv("ask-ai-add-row");
    const addBtn = addRow.createEl("button", { text: "➕ 添加 API" });
    addBtn.className = "mod-cta";
    addBtn.onclick = async () => {
      this.plugin.settings.apis.push({
        name: "New API",
        url: "",
        key: "",
        model: ""
      });
      await this.plugin.saveSettings();
      this.display();
    };
  }
}
