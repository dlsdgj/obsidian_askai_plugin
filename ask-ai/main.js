const {
  Plugin,
  PluginSettingTab,
  Setting,
  MarkdownRenderer,
  Modal,
  Notice,
} = require("obsidian");

module.exports = class AskAiPlugin extends Plugin {
  async onload() {
    console.log("Ask AI 插件已加载");

    await this.loadSettings();
    this.addSettingTab(new AskAiSettingTab(this.app, this));

    this.addCommand({
      id: "ask-ai",
      name: "Ask AI about selection",
      editorCallback: (editor) => {
        this.handleSelection(editor);
      },
    });

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view?.editor) {
          const cm =
            leaf.view.editor.cm?.dom || leaf.view.editor.cm?.display?.wrapper;
          if (cm) {
            cm.addEventListener("mouseup", (evt) => {
              const selection = leaf.view.editor.getSelection();
              if (selection && selection.trim()) {
                this.showFloatingButton(evt, selection, leaf.view.editor);
              }
            });
          }
        }
      })
    );
  }

  onunload() {
    console.log("Ask AI 插件已卸载");
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
        defaultFontFamily: ""
      },
      await this.loadData()
    );
    
    // 完全移除旧版模板相关代码
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  showFloatingButton(evt, selection, editor) {
  const button = document.createElement("button");
  button.textContent = "🤖";
  button.className = "ask-ai-btn";
  button.style.position = "absolute";
  button.style.left = `${evt.pageX + 10}px`;
  button.style.top = `${evt.pageY}px`;
  button.style.zIndex = "9999";
  button.style.width = "25px";
  button.style.height = "25px";
  button.style.fontSize = "1em";
  button.style.borderRadius = "12.5px";

    document.body.appendChild(button);

    const remove = () => button.remove();
    button.onclick = () => {
  if (this.settings.boldOnClick && editor) {
    const selection = editor.getSelection();
    if (selection && !selection.startsWith("**") && !selection.endsWith("**")) {
      editor.replaceSelection(`**${selection}**`);
    }
  }
  new AskModal(this.app, this, selection, editor).open();
  remove();
};


    // 右键：弹出 API 列表
    button.oncontextmenu = (e) => {
      e.preventDefault();

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
      
      // 计算菜单位置，确保完全显示在视口内
      let menuX = e.pageX;
      let menuY = e.pageY;
      
      // 如果菜单右侧超出视口，调整到左侧显示
      if (menuX + menuWidth > viewportWidth) {
        menuX = viewportWidth - menuWidth - 10;
      }
      
      // 如果菜单底部超出视口，调整到上方显示
      if (menuY + menuHeight > viewportHeight) {
        menuY = viewportHeight - menuHeight - 10;
      }
      
      // 设置菜单最终位置
      menu.style.left = `${menuX}px`;
      menu.style.top = `${menuY}px`;

      // 下划线选项
      const underlineItem = document.createElement("div");
      underlineItem.textContent = "下划线";
      underlineItem.style.padding = "4px 8px";
      underlineItem.style.cursor = "pointer";
      underlineItem.style.borderBottom = "1px solid #eee";
      underlineItem.onmouseenter = () => underlineItem.style.background = "var(--background-modifier-hover)";
      underlineItem.onmouseleave = () => underlineItem.style.background = "transparent";
      underlineItem.onclick = () => {
        if (editor) {
          const sel = editor.getSelection();
          if (sel && !sel.startsWith("<u>") && !sel.endsWith("</u>")) {
            editor.replaceSelection(`<u>${sel}</u>`);
          }
        }
        menu.remove();
        remove();
      };
      menu.appendChild(underlineItem);

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
      editItem.onclick = () => {
        menu.remove();
        remove();
        // 直接弹出AI编辑弹窗，输入区预填用户选择内容，不自动发送prompt
        const modal = new AskModal(this.app, this, selection, editor);
        modal._editMode = true;
        modal.open();
      };
      menu.appendChild(editItem);
      
      // 二级菜单变量
      let templateSubMenu = null;
      let subMenuHovered = false;
      
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
          
          // 鼠标悬停效果
          templateItem.onmouseenter = () => {
            templateItem.style.background = "var(--background-modifier-hover)";
          };
          templateItem.onmouseleave = () => {
            templateItem.style.background = "transparent";
          };
          
          // 点击模板时的处理（临时空实现，稍后会替换）
          templateItem.onclick = () => {};
          
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
          templateItem.onclick = () => {
            menu.remove();
            hideTemplateSubMenu();
            remove();
            
            // 创建模态框并传递原始选中内容和模板
            const modal = new AskModal(this.app, this, selection, editor, null, templates[index].template);
            modal._editMode = false; // 非编辑模式，直接发送
            modal.open();
          };
        });
        
        // 添加二级菜单的hover状态追踪
        templateSubMenu.onmouseenter = () => {
          subMenuHovered = true;
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

      // 移除空行选项
      const removeEmptyLinesItem = document.createElement("div");
      removeEmptyLinesItem.textContent = "移除空行";
      removeEmptyLinesItem.style.padding = "4px 8px";
      removeEmptyLinesItem.style.cursor = "pointer";
      removeEmptyLinesItem.style.borderBottom = "1px solid #eee";
      removeEmptyLinesItem.onmouseenter = () => removeEmptyLinesItem.style.background = "var(--background-modifier-hover)";
      removeEmptyLinesItem.onmouseleave = () => removeEmptyLinesItem.style.background = "transparent";
      removeEmptyLinesItem.onclick = () => {
        if (editor) {
          const sel = editor.getSelection();
          if (sel) {
            // 使用正则表达式移除空行
            const textWithoutEmptyLines = sel.replace(/^\s*\n/gm, '').replace(/\n\s*\n/gm, '\n');
            editor.replaceSelection(textWithoutEmptyLines);
          }
        }
        menu.remove();
        remove();
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
      clearFormatItem.onclick = () => {
        if (editor) {
          const sel = editor.getSelection();
          if (sel) {
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
          }
        }
        menu.remove();
        remove();
      };
      menu.appendChild(clearFormatItem);

      // 清除格式并移除空行选项
      const clearFormatAndRemoveEmptyLinesItem = document.createElement("div");
      clearFormatAndRemoveEmptyLinesItem.textContent = "清除格式并移除空行";
      clearFormatAndRemoveEmptyLinesItem.style.padding = "4px 8px";
      clearFormatAndRemoveEmptyLinesItem.style.cursor = "pointer";
      clearFormatAndRemoveEmptyLinesItem.style.borderBottom = "1px solid #eee";
      clearFormatAndRemoveEmptyLinesItem.onmouseenter = () => clearFormatAndRemoveEmptyLinesItem.style.background = "var(--background-modifier-hover)";
      clearFormatAndRemoveEmptyLinesItem.onmouseleave = () => clearFormatAndRemoveEmptyLinesItem.style.background = "transparent";
      clearFormatAndRemoveEmptyLinesItem.onclick = () => {
        if (editor) {
          const sel = editor.getSelection();
          if (sel) {
            // 先清除格式
            let processedText = sel
              .replace(/\*\*(.*?)\*\*/g, '$1')
              .replace(/\*(.*?)\*/g, '$1')
              .replace(/~~(.*?)~~/g, '$1')
              .replace(/`(.*?)`/g, '$1')
              .replace(/^#+\s+/gm, '')
              .replace(/^-{3,}$/gm, '')
              .replace(/^(\d+)\.\s*/gm, '$1 ')
              .replace(/^\s*(\d+)\.\s*/gm, '$1 ')
              .replace(/^\s*\*\s*/gm, '');
            // 再移除空行
            processedText = processedText.replace(/^\s*\n/gm, '').replace(/\n\s*\n/gm, '\n');
            editor.replaceSelection(processedText);
          }
        }
        menu.remove();
        remove();
      };
      menu.appendChild(clearFormatAndRemoveEmptyLinesItem);

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

        item.onclick = () => {
          new AskModal(this.app, this, selection, editor, index).open();
          menu.remove();
          remove();
        };

        menu.appendChild(item);
      });

      document.body.appendChild(menu);

      // 点击外部时移除菜单
      const cleanup = () => {
        menu.remove();
        document.removeEventListener("click", cleanup);
      };
      document.addEventListener("click", cleanup);
    };

    setTimeout(() => {
      document.addEventListener("click", remove, { once: true });
    }, 0);
  }

  async handleSelection(editor) {
    const selectedText = editor.getSelection();
    if (!selectedText) {
      new Notice("没有选中文字");
      return;
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
        
        // 如果是编辑模式，将模板插入到输入框开头
        if (this._editMode && this.inputField) {
          // 替换模板中的变量
          let processedTemplate = selectedTemplate.template;
          if (this.query) {
            processedTemplate = processedTemplate.replace(/{{selection}}/g, this.query);
          }
          if (this.context) {
            processedTemplate = processedTemplate.replace(/{{context}}/g, this.context);
          }
          
          // 将模板插入到输入框开头，不添加空行
          const currentValue = this.inputField.value;
          this.inputField.value = processedTemplate + (currentValue ? currentValue : '');
          this.inputField.focus();
          // 设置光标位置到插入点后面
          this.inputField.setSelectionRange(processedTemplate.length, processedTemplate.length);
          
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

    // 插入 >[!]按钮
    const insertBtn = document.createElement("button");
    insertBtn.textContent = ">[!]";
    insertBtn.style.padding = "4px 8px";
    insertBtn.style.fontSize = "0.8em";
    insertBtn.style.marginRight = "8px";
    insertBtn.onclick = () => {
      let selectedText = this.query || "";
      if (selectedText.length > 10) {
        selectedText = selectedText.slice(0, 10) + "...";
      }
      this.textarea.value = `>[!${selectedText}]\n` + this.textarea.value;
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
        this.textarea.value = err.message || String(err);
      }
    }
  }

  async streamApi(messages, api, outputEl, headerEl, selection, editor, isFollowup = false) {
    if (!api || !api.key || !api.url) {
      outputEl.value += "\n❌ API 没有配置完整";
      return;
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

    const resp = await fetch(api.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + api.key,
      },
      body: JSON.stringify({
        model: api.model || "moonshot-v1-32k",
        stream: true,
        messages: newMessages,
      }),
      signal: this.abortController.signal,
    });

    if (!resp.ok || !resp.body) {
      throw new Error(`HTTP 错误: ${resp.status}`);
    }

    headerEl.setText("AI 回答：");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let fullAnswer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop();

      for (const part of parts) {
        if (part.startsWith("data: ")) {
          const data = part.slice(6).trim();
          if (data === "[DONE]") {
            this.messages.push({ role: "assistant", content: fullAnswer });
            return;
          }
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              outputEl.value += delta;
              fullAnswer += delta;
            }
          } catch (e) {
            console.warn("解析失败:", part, e);
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
      text: "在这里配置多个 API，并选择一个默认 API 用于请求。",
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

    // 每个 API 用卡片包装
    this.plugin.settings.apis.forEach((api, index) => {
      const card = containerEl.createDiv("ask-ai-card");
      if (index === this.plugin.settings.defaultApiIndex) {
        card.addClass("is-default");
      }
      card.createEl("h3", {
        text: api.name || `API ${index + 1}`,
        cls: "ask-ai-card-title",
      });
      new Setting(card)
        .setName("名称")
        .addText((text) =>
          text
            .setPlaceholder("API 名称 (比如 Moonshot)")
            .setValue(api.name || "")
            .onChange(async (value) => {
              api.name = value;
              await this.plugin.saveSettings();
              this.display();
            })
        );
      new Setting(card)
        .setName("地址")
        .addText((text) =>
          text
            .setPlaceholder("API 地址 (https://...)")
            .setValue(api.url || "")
            .onChange(async (value) => {
              api.url = value;
              await this.plugin.saveSettings();
            })
        );
      new Setting(card)
        .setName("密钥")
        .addText((text) =>
          text
            .setPlaceholder("API Key (sk-xxx)")
            .setValue(api.key || "")
            .onChange(async (value) => {
              api.key = value;
              await this.plugin.saveSettings();
            })
        );
      new Setting(card)
        .setName("模型")
        .addText((text) =>
          text
            .setPlaceholder("模型 (可选)")
            .setValue(api.model || "")
            .onChange(async (value) => {
              api.model = value;
              await this.plugin.saveSettings();
            })
        );
      // 操作按钮行
      const buttonRow = card.createDiv("ask-ai-buttons");
      const defaultBtn = buttonRow.createEl("button", { text: "设为默认" });
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