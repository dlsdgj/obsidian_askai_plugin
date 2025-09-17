const { Plugin, Modal, MarkdownView, Setting, PluginSettingTab } = require("obsidian");
// 动态加载 Pickr，无需 require

module.exports = class ColorizeTextPlugin extends Plugin {
  async onload() {
    console.log("ColorizeText 插件已加载");
    // 加载已保存配色和高亮历史
    const data = await this.loadData() || {};
    this.palette = data.palette || [
      { textColor: "#FFFFFF", bgColor: "#000000" }
    ];
    this.highlightHistory = data.highlightHistory || {};
    this.settings = data.settings || {
      apiKey: ""
    };
    
    // 添加设置标签页
    this.addSettingTab(new ColorizeTextSettingsTab(this.app, this));
    this.addCommand({
      id: "colorize-text",
      name: "文字+背景上色",
      hotkeys: [{ modifiers: ["Mod"], key: "k" }],
      editorCallback: (editor, view) => {
        this.openColorModal(editor);
      }
    });
    // 挂载到全局，供弹窗回调使用
    window.colorizeTextPluginInstance = this;
  }
  async savePalette() {
    await this.saveData({
      palette: this.palette,
      highlightHistory: this.highlightHistory,
      settings: this.settings
    });
  }

  async saveSettings() {
    await this.saveData({
      palette: this.palette,
      highlightHistory: this.highlightHistory,
      settings: this.settings
    });
  }
  async saveHighlightHistory(filePath, history) {
    this.highlightHistory[filePath] = history;
    await this.savePalette();
  }
  openColorModal(editor) {
    const selectedText = editor.getSelection();
    let previewText = selectedText || "A";
    if (previewText.length > 3) previewText = previewText.slice(0, 3) + "...";
    // 获取当前文件路径
    const filePath = this.app.workspace.getActiveFile()?.path || "__unknown__";
    const history = this.highlightHistory[filePath] || [];
    new PaletteModal(this.app, this.palette, async (selected) => {
      if (!selectedText) return;
      const wrapped = `<span style=\"color: ${selected.textColor}; background-color: ${selected.bgColor};\">${selectedText}</span>`;
      editor.replaceSelection(wrapped);
      // 保存高亮历史
      const newRecord = {
        text: selectedText,
        textColor: selected.textColor,
        bgColor: selected.bgColor,
        time: Date.now()
      };
      // 只保留最新100条
      const newHistory = [newRecord, ...history.filter(h => h.text !== selectedText)].slice(0, 100);
      await this.saveHighlightHistory(filePath, newHistory);
    }, async (newPair) => {
      this.palette.push(newPair);
      await this.savePalette();
      // 重新打开弹窗时不重复添加新配色，且高亮历史保持
      this.openColorModal(editor);
    }, previewText, history).open();
  }

};


// 设置标签页类
class ColorizeTextSettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    // 添加设置标题
    containerEl.createEl('h2', { text: 'Colorize Text 设置' });

    // API 配置
    new Setting(containerEl)
      .setName('API 名称')
      .setDesc('使用的AI服务名称')
      .addText(text => text
        .setPlaceholder('例如: OpenAI')
        .setValue(this.plugin.settings.apiName || 'OpenAI')
        .onChange(async (value) => {
          this.plugin.settings.apiName = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('API 地址')
      .setDesc('API服务端点地址')
      .addText(text => text
        .setPlaceholder('例如: https://api.openai.com/v1/chat/completions')
        .setValue(this.plugin.settings.apiUrl || 'https://api.openai.com/v1/chat/completions')
        .onChange(async (value) => {
          this.plugin.settings.apiUrl = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('API 模型')
      .setDesc('使用的AI模型名称')
      .addText(text => text
        .setPlaceholder('例如: gpt-3.5-turbo')
        .setValue(this.plugin.settings.apiModel || 'gpt-3.5-turbo')
        .onChange(async (value) => {
          this.plugin.settings.apiModel = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('API 密钥')
      .setDesc('您的AI API密钥')
      .addText(text => text
        .setPlaceholder('输入API密钥')
        .setValue(this.plugin.settings.apiKey || '')
        .onChange(async (value) => {
          this.plugin.settings.apiKey = value;
          await this.plugin.saveSettings();
        }));

  }
}





class PaletteModal extends Modal {
  constructor(app, palette, onSelect, onAdd, previewText, highlightHistory) {
    super(app);
    this.palette = palette;
    this.onSelect = onSelect;
    this.onAdd = onAdd;
    this.previewText = previewText || "A";
    this.highlightHistory = highlightHistory || [];
  }

  async generateAIColor(text, aiRow, editor) {
    if (!window.colorizeTextPluginInstance?.settings?.apiKey) {
      new Notice("请先在设置中配置API Key");
      return;
    }

    new Notice("正在生成AI配色...");
    
    try {
      // 确保aiRow存在
      if (!aiRow) {
        console.error("AI行元素不存在");
        return;
      }

      // 获取当前文件路径
      const filePath = this.app.workspace.getActiveFile()?.path || "__unknown__";
      
      // 获取当前段落的内容作为上下文
      let context = "";
      if (editor) {
        const cursor = editor.getCursor();
        const lineCount = editor.lineCount();
        
        // 向上查找段落开始位置（直到找到空行或文件开头）
        let startLine = cursor.line;
        while (startLine > 0) {
          const prevLine = editor.getLine(startLine - 1);
          if (prevLine.trim() === "") {
            break;
          }
          startLine--;
        }
        
        // 向下查找段落结束位置（直到找到空行或文件结尾）
        let endLine = cursor.line;
        while (endLine < lineCount - 1) {
          const nextLine = editor.getLine(endLine + 1);
          if (nextLine.trim() === "") {
            break;
          }
          endLine++;
        }
        
        // 获取并拼接整个段落的内容
        for (let i = startLine; i <= endLine; i++) {
          context += editor.getLine(i) + "\n";
        }
      }
      
      // 获取当前文件的高亮历史
      let highlightHistory = [];
      if (window.colorizeTextPluginInstance && filePath) {
        highlightHistory = window.colorizeTextPluginInstance.highlightHistory[filePath] || [];
        console.log("当前文件路径:", filePath);
        console.log("获取到的高亮历史数量:", highlightHistory.length);
        console.log("获取到的高亮历史完整数据:", highlightHistory);
        console.log("完整的高亮历史数据结构:", window.colorizeTextPluginInstance.highlightHistory);
        // 记录发送给AI的历史数据数量
        console.log("发送给AI的高亮历史数量:", highlightHistory.length);
      } else {
        console.log("无法获取高亮历史: pluginInstance=", window.colorizeTextPluginInstance, "filePath=", filePath);
      }

      const resultText = aiRow.querySelector(".ai-result-text");
      const aiBtn = aiRow.querySelector("button[title='AI生成配色']"); // 更精确地选择AI按钮
      
      // 验证元素是否存在
      if (!resultText || !aiBtn) {
        console.error("无法找到必要的DOM元素", {resultText, aiBtn});
        return;
      }
      
      // 确保按钮是有效的DOM元素
      if (!(aiBtn instanceof HTMLElement)) {
        console.error("AI按钮不是有效的DOM元素");
        return;
      }
      
      // 确保按钮有style属性
      if (!aiBtn.style) {
        console.error("AI按钮缺少style属性");
        return;
      }

      // 设置初始状态
      resultText.value = "正在获取AI配色...";
      resultText.readOnly = true;

      const response = await fetch(window.colorizeTextPluginInstance.settings.apiUrl || "https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${window.colorizeTextPluginInstance.settings.apiKey}`
        },
        body: JSON.stringify({
          model: window.colorizeTextPluginInstance.settings.apiModel || "deepseek-chat",
          messages: [
            {
              role: "user",
              content: `请为以下文字生成配色方案：${text}
              上下文：
              ${context}
              
              高亮历史(${highlightHistory.length}条记录)：
              ${JSON.stringify(highlightHistory, null, 2)}
              
              要求：
              - 新配色要与高亮历史配色方案有**明显区分**
              - 文字颜色和背景颜色要有足够对比度，确保文字清晰可见

              - 返回格式：<span style="color: #HEX; background-color: #HEX;">文本</span>
              - 可以包含padding、border-radius、fontweight、font-size等样式属性
              - 仅返回html标签及其包裹的文本, 不要其他解释文字`
            //  - 请在返回内容中明确展示所有高亮历史数据，不要省略或简化
            //- 请在返回内容中注明收到了多少条高亮历史记录
            }
          ],
          temperature: 0.7,
          max_tokens: 3000 // 增加token数量以确保完整返回
        })
      });

      const data = await response.json();
      
      if (data.choices && data.choices[0]?.message?.content) {
        const result = data.choices[0].message.content;
        resultText.value = result;
        resultText.readOnly = false;
        
        // 尝试解析颜色更新按钮样式（支持包含padding等额外样式）
        const match = result.match(/<span[^>]+style="[^"]*color:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3});[^"]*background-color:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})[^"]*"[^>]*>/i) || 
                     result.match(/<span[^>]+style="[^"]*background-color:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3});[^"]*color:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})[^"]*"[^>]*>/i) ||
                     result.match(/<span[^>]+style="[^"]*color:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3});[^;]*;[^"]*background-color:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})[^"]*"[^>]*>/i) ||
                     result.match(/<span[^>]+style="[^"]*background-color:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3});[^;]*;[^"]*color:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})[^"]*"[^>]*>/i);
        
        if (match) {
          const textColor = match[1];
          const bgColor = match[2];
          
          // 安全地更新AI按钮样式
          try {
            aiBtn.style.color = textColor;
            aiBtn.style.background = bgColor;
          } catch (e) {
            console.error("更新按钮样式失败:", e);
          }
          
          // 不再自动添加到配色方案，只在应用时添加到高亮历史
        } else {
          new Notice("无法解析AI返回的配色方案");
        }
      } else {
        new Notice("AI生成配色失败");
      }
    } catch (error) {
      console.error("AI配色生成错误:", error);
      new Notice("AI配色生成失败，请检查API Key和网络连接");
    }
  }

  async onOpen() {
    let { contentEl } = this;
    contentEl.empty();
    contentEl.style.minWidth = "340px";
    contentEl.style.padding = "18px";
    // 添加弹窗标题（如果没有）
    if (!contentEl.querySelector('.colorize-modal-title')) {
      const title = document.createElement("div");
      title.className = "colorize-modal-title";
      title.innerText = this.highlightHistory && this.highlightHistory.length > 0 ? "配色方案与高亮历史" : "配色方案";
      title.style.fontSize = "18px";
      title.style.fontWeight = "bold";
      title.style.marginBottom = "14px";
      contentEl.appendChild(title);
    }

    const row = contentEl.createEl("div");
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.flexWrap = "wrap";
    row.style.marginBottom = "8px";

    // 渲染所有配色色块
    this.palette.forEach((pair, idx) => {
      const btn = document.createElement("button");
      btn.style.display = "inline-flex";
      btn.style.alignItems = "center";
      btn.style.justifyContent = "center";
      btn.style.background = pair.bgColor;
      btn.style.color = pair.textColor;
      btn.style.fontWeight = "normal";
      btn.style.fontSize = "14px";
      btn.style.border = "none";
      btn.style.borderRadius = "4px";
      btn.style.cursor = "pointer";
      btn.style.padding = "0 8px";
      btn.style.margin = "0";
      btn.title = `文字:${pair.textColor} 背景:${pair.bgColor}`;
      btn.innerText = this.previewText;
      btn.style.height = "auto";
      btn.style.minHeight = "22px";
      btn.style.width = "auto";
      btn.style.minWidth = "32px";
      btn.addEventListener("click", () => {
        this.onSelect(pair);
        this.close();
      });
      // 右键菜单：应用到所有匹配 + 移除配色方案
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        // 弹出菜单
        const menu = document.createElement("div");
        menu.style.position = "fixed";
        menu.style.left = e.clientX + "px";
        menu.style.top = e.clientY + "px";
        menu.style.background = "#fff";
        menu.style.border = "1px solid #ccc";
        menu.style.borderRadius = "6px";
        menu.style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)";
        menu.style.zIndex = "99999";
        menu.style.padding = "4px 0";
        menu.style.minWidth = "120px";
        const item = document.createElement("div");
        item.innerText = "应用到所有匹配";
        item.style.padding = "8px 16px";
        item.style.cursor = "pointer";
        item.addEventListener("mouseenter", () => { item.style.background = "#f0f0f0"; });
        item.addEventListener("mouseleave", () => { item.style.background = "#fff"; });
        item.addEventListener("click", () => {
          menu.remove();
          // 获取当前选中的文本（应为原始选区，而不是预览文本）
          const activeLeaf = this.app.workspace.activeLeaf;
          if (!activeLeaf) return;
          const view = activeLeaf.view;
          if (!view || !view.editor) return;
          const editor = view.editor;
          let selectedText = editor.getSelection();
          if (!selectedText) selectedText = this.previewText.replace(/\.\.\.$/, "");
          const content = editor.getValue();
          if (!selectedText) return;
          // 匹配所有未被包裹的完整选中文本
          const spanReg = new RegExp(`<span[^>]*>\s*${selectedText}\s*<\/span>`, "g");
          let replaced = false;
          // 只替换未包裹的完整文本（不拆分重复子串）
          let newContent = content.replace(new RegExp(`(?<!<span[^>]*>)${selectedText}(?!<\/span>)`, "g"), (match, offset, str) => {
            // 跳过已包裹的
            if (spanReg.test(str.slice(Math.max(0, offset - 30), offset + match.length + 30))) return match;
            replaced = true;
            return `<span style=\"color: ${pair.textColor}; background-color: ${pair.bgColor};\">${match}</span>`;
          });
          if (replaced) {
            // 记录原光标和滚动条位置
            const oldCursor = editor.getCursor();
            const oldScroll = editor.getScrollInfo ? editor.getScrollInfo() : null;
            editor.setValue(newContent);
            // 恢复光标
            if (oldCursor) editor.setCursor(oldCursor);
            // 恢复滚动条
            if (oldScroll && editor.scrollTo) editor.scrollTo(oldScroll.left, oldScroll.top);
            // 保存高亮历史
            const filePath = this.app.workspace.getActiveFile()?.path || "__unknown__";
            if (window.colorizeTextPluginInstance) {
              const plugin = window.colorizeTextPluginInstance;
              const history = plugin.highlightHistory[filePath] || [];
              const newRecord = {
                text: selectedText,
                textColor: pair.textColor,
                bgColor: pair.bgColor,
                time: Date.now()
              };
              // 只保留最新100条
              plugin.highlightHistory[filePath] = [newRecord, ...history.filter(h => h.text !== selectedText)].slice(0, 100);
              plugin.savePalette();
            }
          }
          // 应用后关闭弹窗
          this.close();
        });
        menu.appendChild(item);
        // 新增移除配色方案菜单项
        const removeScheme = document.createElement("div");
        removeScheme.innerText = "移除";
        removeScheme.style.padding = "8px 16px";
        removeScheme.style.cursor = "pointer";
        removeScheme.addEventListener("mouseenter", () => { removeScheme.style.background = "#f0f0f0"; });
        removeScheme.addEventListener("mouseleave", () => { removeScheme.style.background = "#fff"; });
        removeScheme.addEventListener("click", async () => {
          menu.remove();
          // 从配色方案中移除该项
          if (window.colorizeTextPluginInstance) {
            const plugin = window.colorizeTextPluginInstance;
            plugin.palette = plugin.palette.filter(p => p.textColor !== pair.textColor || p.bgColor !== pair.bgColor);
            await plugin.savePalette();
          }
          this.close();
        });
        menu.appendChild(removeScheme);
        document.body.appendChild(menu);
        // 点击其他区域关闭菜单
        const closeMenu = (ev) => {
          if (!menu.contains(ev.target)) menu.remove();
        };
        setTimeout(() => {
          document.addEventListener("mousedown", closeMenu, { once: true });
        }, 0);
      });
      row.appendChild(btn);
    });

    // 添加按钮
    const addBtn = document.createElement("button");
    addBtn.style.display = "inline-flex";
    addBtn.style.alignItems = "center";
    addBtn.style.justifyContent = "center";
    addBtn.style.background = "#eee";
    addBtn.style.color = "#333";
    addBtn.style.fontWeight = "bold";
    addBtn.style.fontSize = "18px";
    addBtn.style.border = "1px dashed #aaa";
    addBtn.style.borderRadius = "4px";
    addBtn.style.cursor = "pointer";
    addBtn.style.padding = "0 8px";
    addBtn.style.height = "auto";
    addBtn.style.minHeight = "22px";
    addBtn.style.width = "auto";
    addBtn.style.minWidth = "32px";
    addBtn.title = "添加新配色";
    addBtn.innerText = "+";
    addBtn.addEventListener("click", () => {
      this.openAddDialog();
    });
    row.appendChild(addBtn);

    // 添加AI生成配色按钮区域
    if (window.colorizeTextPluginInstance?.settings?.apiKey) {
      const aiRow = contentEl.createEl("div");
      aiRow.style.display = "flex";
      aiRow.style.alignItems = "center";
      aiRow.style.gap = "8px";
      aiRow.style.margin = "12px 0";
      
      // AI按钮
      const aiBtn = document.createElement("button");
      aiBtn.style.display = "inline-flex";
      aiBtn.style.alignItems = "center";
      aiBtn.style.justifyContent = "center";
      aiBtn.style.background = this.palette[0].bgColor || "#4caf50";
      aiBtn.style.color = this.palette[0].textColor || "#fff";
      aiBtn.style.fontWeight = "bold";
      aiBtn.style.fontSize = "14px";
      aiBtn.style.border = "none";
      aiBtn.style.borderRadius = "4px";
      aiBtn.style.cursor = "pointer";
      aiBtn.style.padding = "6px 12px";
      aiBtn.style.height = "auto";
      aiBtn.style.minHeight = "32px";
      aiBtn.style.width = "auto";
      aiBtn.style.minWidth = "80px";
      aiBtn.title = "AI生成配色";
      
      // 显示选中的文本（最多4个字符）
      const selectedText = this.app.workspace.activeLeaf?.view?.editor?.getSelection();
      const displayText = selectedText ? 
        (selectedText.length > 4 ? selectedText.slice(0, 4) + "..." : selectedText) : 
        "AI配色";
      aiBtn.innerText = displayText;
      
      // 单击应用配色
      aiBtn.addEventListener("click", () => {
        const editor = this.app.workspace.activeLeaf?.view?.editor;
        if (editor && resultText.value) {
          const selectedText = editor.getSelection();
          if (selectedText) {
            editor.replaceSelection(resultText.value);
            // 添加到高亮历史
            const filePath = this.app.workspace.getActiveFile()?.path || "__unknown__";
            if (window.colorizeTextPluginInstance) {
              const plugin = window.colorizeTextPluginInstance;
              const history = plugin.highlightHistory[filePath] || [];
              const match = resultText.value.match(/<span[^>]+style="[^"]*color:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3});[^"]*background-color:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})[^"]*"[^>]*>/i);
              if (match) {
                const newRecord = {
                  text: selectedText,
                  textColor: match[1],
                  bgColor: match[2],
                  time: Date.now()
                };
                plugin.highlightHistory[filePath] = [newRecord, ...history.filter(h => h.text !== selectedText)].slice(0, 100);
                plugin.savePalette();
                this.close(); // 关闭弹窗
              }
            }
          }
        }
      });
      
      // 右键菜单：应用到所有匹配
      aiBtn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const menu = document.createElement("div");
        menu.style.position = "fixed";
        menu.style.left = e.clientX + "px";
        menu.style.top = e.clientY + "px";
        menu.style.background = "#fff";
        menu.style.border = "1px solid #ccc";
        menu.style.borderRadius = "6px";
        menu.style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)";
        menu.style.zIndex = "99999";
        menu.style.padding = "4px 0";
        menu.style.minWidth = "140px";
        
        const applyAllItem = document.createElement("div");
        applyAllItem.innerText = "应用到所有匹配";
        applyAllItem.style.padding = "8px 16px";
        applyAllItem.style.cursor = "pointer";
        applyAllItem.addEventListener("mouseenter", () => { applyAllItem.style.background = "#f0f0f0"; });
        applyAllItem.addEventListener("mouseleave", () => { applyAllItem.style.background = "#fff"; });
        applyAllItem.addEventListener("click", () => {
          menu.remove();
          const editor = this.app.workspace.activeLeaf?.view?.editor;
          if (editor && resultText.value) {
            const selectedText = editor.getSelection();
            if (!selectedText) return;
            const content = editor.getValue();
            // 从文本框获取完整的HTML内容
            const htmlContent = resultText.value;
            // 解析颜色值
            const colorMatch = htmlContent.match(/<span[^>]+style="[^"]*color:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3});[^"]*background-color:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})[^"]*"[^>]*>/i);
            if (colorMatch) {
              const textColor = colorMatch[1];
              const bgColor = colorMatch[2];
              const spanReg = new RegExp(`<span[^>]*>\s*${selectedText}\s*<\/span>`, "g");
              let replaced = false;
              // 获取完整的样式字符串
              const fullStyleMatch = htmlContent.match(/<span[^>]+style="([^"]*)"[^>]*>/i);
              const fullStyle = fullStyleMatch ? fullStyleMatch[1] : `color: ${textColor}; background-color: ${bgColor}`;
              
              let newContent = content.replace(new RegExp(`(?<!<span[^>]*>)${selectedText}(?!<\/span>)`, "g"), (matchText, offset, str) => {
                if (spanReg.test(str.slice(Math.max(0, offset - 30), offset + matchText.length + 30))) return matchText;
                replaced = true;
                return `<span style=\"${fullStyle}\">${matchText}</span>`;
              });
              if (replaced) {
                const oldCursor = editor.getCursor();
                const oldScroll = editor.getScrollInfo ? editor.getScrollInfo() : null;
                editor.setValue(newContent);
                if (oldCursor) editor.setCursor(oldCursor);
                if (oldScroll && editor.scrollTo) editor.scrollTo(oldScroll.left, oldScroll.top);
                // 添加到高亮历史
                const filePath = this.app.workspace.getActiveFile()?.path || "__unknown__";
                if (window.colorizeTextPluginInstance) {
                  const plugin = window.colorizeTextPluginInstance;
                  const history = plugin.highlightHistory[filePath] || [];
                  const newRecord = {
                    text: selectedText,
                    textColor: colorMatch[1],
                    bgColor: colorMatch[2],
                    time: Date.now()
                  };
                  plugin.highlightHistory[filePath] = [newRecord, ...history.filter(h => h.text !== selectedText)].slice(0, 100);
                  plugin.savePalette();
                  this.close(); // 关闭弹窗
                }
              }
            }
          }
        });
        menu.appendChild(applyAllItem);
        document.body.appendChild(menu);
        setTimeout(() => {
          document.addEventListener("mousedown", (ev) => {
            if (!menu.contains(ev.target)) menu.remove();
          }, { once: true });
        }, 0);
      });
      
      aiRow.appendChild(aiBtn);

      // AI结果文本框（可编辑）
      const resultText = document.createElement("textarea");
      resultText.className = "ai-result-text";
      resultText.style.flex = "1";
      resultText.style.padding = "8px";
      resultText.style.border = "1px solid #ddd";
      resultText.style.borderRadius = "4px";
      resultText.style.backgroundColor = "#f8f8f8";
      resultText.style.minHeight = "32px";
      resultText.style.overflow = "auto";
      resultText.style.fontSize = "13px";
      resultText.style.resize = "vertical";
      resultText.readOnly = true;
      resultText.innerText = "正在获取AI配色...";
      aiRow.appendChild(resultText);

      // 文本框修改时实时更新AI按钮样式
      resultText.addEventListener("input", () => {
        const match = resultText.value.match(/<span[^>]+style="[^"]*color:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3});[^"]*background-color:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})[^"]*"[^>]*>/i);
        if (match) {
          aiBtn.style.color = match[1];
          aiBtn.style.background = match[2];
        }
      });

      // 弹窗打开时自动发送请求给AI
      if (selectedText) {
        // 获取编辑器实例并传递给generateAIColor方法
        const editor = this.app.workspace.activeLeaf?.view?.editor;
        this.generateAIColor(selectedText, aiRow, editor);
      }
    }

    // 高亮历史展示
    if (this.highlightHistory.length > 0) {
      const historyTitle = document.createElement("div");
      historyTitle.innerText = "高亮历史";
      historyTitle.style.margin = "18px 0 6px 0";
      historyTitle.style.fontWeight = "bold";
      contentEl.appendChild(historyTitle);
      this.highlightHistory.forEach(h => {
        const item = document.createElement("div");
        item.style.display = "inline-block";
        item.style.margin = "2px 8px 2px 0";
        item.style.padding = "2px 8px";
        item.style.background = h.bgColor;
        item.style.color = h.textColor;
        item.style.borderRadius = "4px";
        item.style.fontSize = "13px";
        item.style.cursor = "pointer";
        item.innerText = h.text.length > 16 ? h.text.slice(0, 16) + "..." : h.text;
        item.title = h.text;
        item.addEventListener("click", () => {
          // 只定位并选中页面第一个匹配文本，不再自动高亮
          const activeLeaf = this.app.workspace.activeLeaf;
          if (!activeLeaf) return;
          const view = activeLeaf.view;
          if (!view || !view.editor) return;
          const editor = view.editor;
          const content = editor.getValue();
          const idx = content.indexOf(h.text);
          if (idx !== -1) {
            const startLine = content.substr(0, idx).split('\n').length - 1;
            const startCh = idx - content.lastIndexOf('\n', idx - 1) - 1;
            const endLine = content.substr(0, idx + h.text.length).split('\n').length - 1;
            const endCh = idx + h.text.length - content.lastIndexOf('\n', idx + h.text.length - 1) - 1;
            editor.setSelection({ line: startLine, ch: startCh }, { line: endLine, ch: endCh });
            editor.scrollIntoView({ from: { line: startLine, ch: startCh }, to: { line: endLine, ch: endCh } });
          }
          this.close();
        });
        // 右键菜单：添加应用和移除选项
        item.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          // 弹出菜单
          const menu = document.createElement("div");
          menu.style.position = "fixed";
          menu.style.left = e.clientX + "px";
          menu.style.top = e.clientY + "px";
          menu.style.background = "#fff";
          menu.style.border = "1px solid #ccc";
          menu.style.borderRadius = "6px";
          menu.style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)";
          menu.style.zIndex = "99999";
          menu.style.padding = "4px 0";
          menu.style.minWidth = "140px";
          
          // 应用到当前选项
          const applyCurrentItem = document.createElement("div");
          applyCurrentItem.innerText = "应用到当前";
          applyCurrentItem.style.padding = "8px 16px";
          applyCurrentItem.style.cursor = "pointer";
          applyCurrentItem.addEventListener("mouseenter", () => { applyCurrentItem.style.background = "#f0f0f0"; });
          applyCurrentItem.addEventListener("mouseleave", () => { applyCurrentItem.style.background = "#fff"; });
          applyCurrentItem.addEventListener("click", () => {
            menu.remove();
            // 应用到当前选中的文本
            const activeLeaf = this.app.workspace.activeLeaf;
            if (!activeLeaf) return;
            const view = activeLeaf.view;
            if (!view || !view.editor) return;
            const editor = view.editor;
            const selectedText = editor.getSelection();
            if (selectedText) {
              const wrapped = `<span style="color: ${h.textColor}; background-color: ${h.bgColor};">${selectedText}</span>`;
              editor.replaceSelection(wrapped);
              // 更新高亮历史
              const filePath = this.app.workspace.getActiveFile()?.path || "__unknown__";
              if (window.colorizeTextPluginInstance) {
                const plugin = window.colorizeTextPluginInstance;
                const history = plugin.highlightHistory[filePath] || [];
                const newRecord = {
                  text: selectedText,
                  textColor: h.textColor,
                  bgColor: h.bgColor,
                  time: Date.now()
                };
                plugin.highlightHistory[filePath] = [newRecord, ...history.filter(item => item.text !== selectedText)].slice(0, 100);
                plugin.savePalette();
              }
              this.close();
            }
          });
          menu.appendChild(applyCurrentItem);
          
          // 应用到所有匹配选项
          const applyAllItem = document.createElement("div");
          applyAllItem.innerText = "应用到所有匹配";
          applyAllItem.style.padding = "8px 16px";
          applyAllItem.style.cursor = "pointer";
          applyAllItem.addEventListener("mouseenter", () => { applyAllItem.style.background = "#f0f0f0"; });
          applyAllItem.addEventListener("mouseleave", () => { applyAllItem.style.background = "#fff"; });
          applyAllItem.addEventListener("click", () => {
            menu.remove();
            // 应用到所有匹配的文本
            const activeLeaf = this.app.workspace.activeLeaf;
            if (!activeLeaf) return;
            const view = activeLeaf.view;
            if (!view || !view.editor) return;
            const editor = view.editor;
            const content = editor.getValue();
            const escText = h.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const spanReg = new RegExp(`<span[^>]*>\s*${escText}\s*<\\/span>`, "g");
            let replaced = false;
            let newContent = content.replace(new RegExp(`(?<!<span[^>]*>)${escText}(?!<\\/span>)`, "g"), (matchText, offset, str) => {
              if (spanReg.test(str.slice(Math.max(0, offset - 30), offset + matchText.length + 30))) return matchText;
              replaced = true;
              return `<span style="color: ${h.textColor}; background-color: ${h.bgColor};">${matchText}</span>`;
            });
            if (replaced) {
              const oldCursor = editor.getCursor();
              const oldScroll = editor.getScrollInfo ? editor.getScrollInfo() : null;
              editor.setValue(newContent);
              if (oldCursor) editor.setCursor(oldCursor);
              if (oldScroll && editor.scrollTo) editor.scrollTo(oldScroll.left, oldScroll.top);
              // 更新高亮历史
              const filePath = this.app.workspace.getActiveFile()?.path || "__unknown__";
              if (window.colorizeTextPluginInstance) {
                const plugin = window.colorizeTextPluginInstance;
                const history = plugin.highlightHistory[filePath] || [];
                const newRecord = {
                  text: h.text,
                  textColor: h.textColor,
                  bgColor: h.bgColor,
                  time: Date.now()
                };
                plugin.highlightHistory[filePath] = [newRecord, ...history.filter(item => item.text !== h.text)].slice(0, 100);
                plugin.savePalette();
              }
              this.close();
            }
          });
          menu.appendChild(applyAllItem);
          
          // 分隔线
          const separator = document.createElement("div");
          separator.style.height = "1px";
          separator.style.background = "#eee";
          separator.style.margin = "4px 0";
          menu.appendChild(separator);
          
          // 从历史中移除选项
          const removeHistoryItem = document.createElement("div");
          removeHistoryItem.innerText = "从历史中移除";
          removeHistoryItem.style.padding = "8px 16px";
          removeHistoryItem.style.cursor = "pointer";
          removeHistoryItem.addEventListener("mouseenter", () => { removeHistoryItem.style.background = "#f0f0f0"; });
          removeHistoryItem.addEventListener("mouseleave", () => { removeHistoryItem.style.background = "#fff"; });
          removeHistoryItem.addEventListener("click", async () => {
            menu.remove();
            // 只从高亮历史中移除该项，不影响正文高亮
            const activeLeaf = this.app.workspace.activeLeaf;
            if (!activeLeaf) return;
            const view = activeLeaf.view;
            if (!view || !view.editor) return;
            const editor = view.editor;
            const content = editor.getValue();
            // 更强的高亮移除正则，兼容属性顺序、单双引号、空格
            const escText = h.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const spanReg = new RegExp(`<span[^>]*>\s*${escText}\s*<\/span>`, "gi");
            let newContent = content.replace(spanReg, h.text);
            // 恢复原光标和滚动条位置
            const oldCursor = editor.getCursor();
            const oldScroll = editor.getScrollInfo ? editor.getScrollInfo() : null;
            editor.setValue(newContent);
            if (oldCursor) editor.setCursor(oldCursor);
            if (oldScroll && editor.scrollTo) editor.scrollTo(oldScroll.left, oldScroll.top);
            // 从高亮历史中删除该项
            const filePath = this.app.workspace.getActiveFile()?.path || "__unknown__";
            if (window.colorizeTextPluginInstance) {
              const plugin = window.colorizeTextPluginInstance;
              const history = plugin.highlightHistory[filePath] || [];
              plugin.highlightHistory[filePath] = history.filter(item => item.text !== h.text || item.bgColor !== h.bgColor || item.textColor !== h.textColor);
              await plugin.savePalette();
            }
            this.close();
          });

          // 移除所有匹配高亮
          const removeItem = document.createElement("div");
          removeItem.innerText = "移除所有匹配高亮";
          removeItem.style.padding = "8px 16px";
          removeItem.style.cursor = "pointer";
          removeItem.addEventListener("mouseenter", () => { removeItem.style.background = "#f0f0f0"; });
          removeItem.addEventListener("mouseleave", () => { removeItem.style.background = "#fff"; });
          removeItem.addEventListener("click", async () => {
            menu.remove();
            // 移除所有匹配文本的高亮
            const activeLeaf = this.app.workspace.activeLeaf;
            if (!activeLeaf) return;
            const view = activeLeaf.view;
            if (!view || !view.editor) return;
            const editor = view.editor;
            const content = editor.getValue();
            const escText = h.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const spanReg = new RegExp(`<span[^>]*>\s*${escText}\s*</span>`, "gi");
            let newContent = content.replace(spanReg, h.text);
            const oldCursor = editor.getCursor();
            const oldScroll = editor.getScrollInfo ? editor.getScrollInfo() : null;
            editor.setValue(newContent);
            if (oldCursor) editor.setCursor(oldCursor);
            if (oldScroll && editor.scrollTo) editor.scrollTo(oldScroll.left, oldScroll.top);
            // 从高亮历史中删除该项
            const filePath = this.app.workspace.getActiveFile()?.path || "__unknown__";
            if (window.colorizeTextPluginInstance) {
              const plugin = window.colorizeTextPluginInstance;
              const history = plugin.highlightHistory[filePath] || [];
              plugin.highlightHistory[filePath] = history.filter(item => item.text !== h.text || item.bgColor !== h.bgColor || item.textColor !== h.textColor);
              await plugin.savePalette();
            }
            this.close();
          });
          
          menu.appendChild(removeHistoryItem);
          menu.appendChild(removeItem);
          document.body.appendChild(menu);
          // 点击其他区域关闭菜单
          const closeMenu = (ev) => {
            if (!menu.contains(ev.target)) menu.remove();
          };
          setTimeout(() => {
            document.addEventListener("mousedown", closeMenu, { once: true });
          }, 0);
        });
        contentEl.appendChild(item);
      });
    }

  }

  openAddDialog() {
    const contentEl = this.contentEl;
    contentEl.empty();
    contentEl.style.minWidth = "340px";
    contentEl.style.padding = "24px";
    // 临时清空剪贴板
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText("");
    }
    // 添加弹窗标题（如果没有）
    if (!contentEl.querySelector('.colorize-modal-title')) {
      const title = document.createElement("div");
      title.className = "colorize-modal-title";
      title.innerText = "新配色";
      title.style.fontSize = "18px";
      title.style.fontWeight = "bold";
      title.style.marginBottom = "14px";
      contentEl.appendChild(title);
    }

    // 预设颜色
    const COLORS = [
      "#000000", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF", "#FFFFFF",
      "#FFA500", "#800080", "#008000", "#808000", "#C0C0C0", "#808080", "#FFD700", "#A52A2A"
    ];

    let textColor = COLORS[0];
    let bgColor = COLORS[7];

    // 预览按钮样式优化（提前定义，供输入框和色块区联动）
    const preview = document.createElement("button");
    preview.innerText = "这是一段预览文字";
    preview.style.display = "inline-flex";
    preview.style.alignItems = "center";
    preview.style.justifyContent = "center";
    preview.style.background = bgColor;
    preview.style.color = textColor;
    preview.style.fontWeight = "normal";
    preview.style.fontSize = "14px";
    preview.style.border = "none";
    preview.style.borderRadius = "4px";
    preview.style.cursor = "default";
    preview.style.padding = "0 8px";
    preview.style.margin = "12px auto";
    preview.style.height = "auto";
    preview.style.minHeight = "22px";
    preview.style.width = "auto";
    preview.style.minWidth = "32px";

    // 文字色选择 + 输入框（同一行），色块另起一行
    const textRowWrap = document.createElement("div");
    textRowWrap.style.display = "flex";
    textRowWrap.style.alignItems = "center";
    textRowWrap.style.marginBottom = "6px";
    const textLabel = document.createElement("span");
    textLabel.innerText = "文字颜色: ";
    textLabel.style.marginRight = "6px";
    textRowWrap.appendChild(textLabel);
    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.value = textColor;
    textInput.style.width = "80px";
    textInput.style.marginRight = "8px";
    textInput.style.border = "1px solid #ccc";
    textInput.style.borderRadius = "4px";
    textInput.style.height = "22px";
    textInput.style.fontSize = "13px";
    textInput.addEventListener("input", () => {
      textColor = textInput.value;
      preview.style.color = textColor;
    });
    textRowWrap.appendChild(textInput);
    setTimeout(() => { textInput.focus(); }, 0);

    // 文字色块区
    const textRow = document.createElement("div");
    textRow.style.display = "flex";
    textRow.style.marginBottom = "10px";
    COLORS.forEach(c => {
      const btn = document.createElement("button");
      btn.innerText = "A";
      btn.style.background = "transparent";
      btn.style.color = c;
      btn.style.width = "24px";
      btn.style.height = "24px";
      btn.style.fontSize = "16px";
      btn.style.fontWeight = "bold";
      btn.style.border = "none";
      btn.style.borderRadius = "0";
      btn.style.cursor = "pointer";
      btn.style.padding = "0";
      btn.style.margin = "0";
      btn.title = c;
      btn.addEventListener("click", () => {
        textColor = c;
        textInput.value = c;
        preview.style.color = c;
      });
      textRow.appendChild(btn);
    });

    // 背景色选择 + 输入框（同一行），色块另起一行
    const bgRowWrap = document.createElement("div");
    bgRowWrap.style.display = "flex";
    bgRowWrap.style.alignItems = "center";
    bgRowWrap.style.marginBottom = "6px";
    const bgLabel = document.createElement("span");
    bgLabel.innerText = "背景颜色: ";
    bgLabel.style.marginRight = "6px";
    bgRowWrap.appendChild(bgLabel);
    const bgInput = document.createElement("input");
    bgInput.type = "text";
    bgInput.value = bgColor;
    bgInput.style.width = "80px";
    bgInput.style.marginRight = "8px";
    bgInput.style.border = "1px solid #ccc";
    bgInput.style.borderRadius = "4px";
    bgInput.style.height = "22px";
    bgInput.style.fontSize = "13px";
    bgInput.addEventListener("input", () => {
      bgColor = bgInput.value;
      preview.style.background = bgColor;
    });
    bgRowWrap.appendChild(bgInput);

    // 背景色块区
    const bgRow = document.createElement("div");
    bgRow.style.display = "flex";
    bgRow.style.marginBottom = "10px";
    COLORS.forEach(c => {
      const btn = document.createElement("button");
      btn.style.background = c;
      btn.style.width = "24px";
      btn.style.height = "24px";
      btn.style.border = "none";
      btn.style.borderRadius = "0";
      btn.style.cursor = "pointer";
      btn.style.padding = "0";
      btn.style.margin = "0";
      btn.title = c;
      btn.addEventListener("click", () => {
        bgColor = c;
        bgInput.value = c;
        preview.style.background = c;
      });
      bgRow.appendChild(btn);
    });

    // 剪贴板自动填充逻辑：循环收集颜色，收集到两个后自动填充，继续等待下一组
    function isColor(str) {
      return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(str.trim()) ||
        /^rgb\s*\(/i.test(str.trim()) ||
        /^rgba\s*\(/i.test(str.trim());
    }
    let colorQueue = [];
    let clipboardInterval;

    function showTooltip(message) {
      const tooltip = document.createElement('div');
      tooltip.innerText = message;
      tooltip.style.position = 'fixed';
      tooltip.style.left = '50%';
      tooltip.style.top = '12%';
      tooltip.style.transform = 'translate(-50%, 0)';
      tooltip.style.background = '#333';
      tooltip.style.color = '#fff';
      tooltip.style.padding = '8px 18px';
      tooltip.style.borderRadius = '8px';
      tooltip.style.fontSize = '15px';
      tooltip.style.zIndex = '99999';
      tooltip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.18)';
      document.body.appendChild(tooltip);
      setTimeout(() => {
        tooltip.remove();
      }, 1800);
    }
    function startClipboardMonitor() {
      if (clipboardInterval) return;
      clipboardInterval = setInterval(async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (isColor(text) && !colorQueue.includes(text)) {
            colorQueue.push(text);
            await navigator.clipboard.writeText(""); // 清空剪贴板
            if (colorQueue.length === 2) {
              textInput.value = colorQueue[0];
              textColor = colorQueue[0];
              preview.style.color = colorQueue[0];
              bgInput.value = colorQueue[1];
              bgColor = colorQueue[1];
              preview.style.background = colorQueue[1];
              showTooltip('新颜色已填充');
              colorQueue = [];
            }
          }
        } catch {}
      }, 500);
    }
    function stopClipboardMonitor() {
      if (clipboardInterval) {
        clearInterval(clipboardInterval);
        clipboardInterval = null;
      }
    }
    // 进入弹窗即开始监听，关闭弹窗停止
    startClipboardMonitor();
    this.onClose = stopClipboardMonitor;

    // 确认按钮
    const okBtn = document.createElement("button");
    okBtn.innerText = "添加";
    okBtn.style.padding = "6px 18px";
    okBtn.style.fontWeight = "bold";
    okBtn.style.borderRadius = "6px";
    okBtn.style.border = "1px solid #888";
    okBtn.style.background = "#4caf50";
    okBtn.style.color = "#fff";
    okBtn.style.cursor = "pointer";
    okBtn.addEventListener("click", () => {
      this.onAdd({ textColor, bgColor });
      this.close();
    });

    // 取消按钮
    const cancelBtn = document.createElement("button");
    cancelBtn.innerText = "取消";
    cancelBtn.style.padding = "6px 18px";
    cancelBtn.style.fontWeight = "bold";
    cancelBtn.style.borderRadius = "6px";
    cancelBtn.style.border = "1px solid #888";
    cancelBtn.style.background = "#eee";
    cancelBtn.style.color = "#333";
    cancelBtn.style.cursor = "pointer";
    cancelBtn.addEventListener("click", () => {
      this.close();
    });

    // 按钮区（右侧并排）
    const btnRow = document.createElement("div");
    btnRow.style.display = "flex";
    btnRow.style.justifyContent = "flex-end";
    btnRow.style.alignItems = "center";
    btnRow.style.gap = "12px";
    btnRow.style.marginTop = "12px";
    btnRow.appendChild(okBtn);
    btnRow.appendChild(cancelBtn);

    // 按顺序渲染所有区域
    contentEl.appendChild(textRowWrap);
    contentEl.appendChild(textRow);
    contentEl.appendChild(bgRowWrap);
    contentEl.appendChild(bgRow);
    contentEl.appendChild(preview);
    contentEl.appendChild(btnRow);
  }
};
