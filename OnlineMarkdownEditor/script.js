// Global variables
let editor;
let preview;
let history = [];
let historyIndex = -1;
let isUpdatingFromHistory = false;
let currentFontSize = 14;

// Wait for DOM to load
document.addEventListener('DOMContentLoaded', function() {
    // Initialize elements
    editor = document.getElementById('editor');
    preview = document.getElementById('preview');

    // Setup resizer
    const resizer = document.getElementById('resizer');
    resizer.addEventListener('mousedown', initResize);

    // Initialize editor
    init();
});

// --- Resizer Functionality ---
let isResizing = false;
function initResize(e) {
    isResizing = true;
    const previewPane = document.getElementById('previewPane');
    const mainContent = document.getElementById('mainContent');
    const isVertical = window.innerWidth <= 768;
    
    let start, startSize;
    if (isVertical) {
        start = e.clientY;
        startSize = previewPane.offsetHeight;
    } else {
        start = e.clientX;
        startSize = previewPane.offsetWidth;
    }

    function doResize(e) {
        if (!isResizing) return;
        let newSize;
        if (isVertical) {
            const diff = e.clientY - start;
            newSize = startSize + diff;
            const parentSize = mainContent.offsetHeight;
             if (newSize >= parentSize * 0.15 && newSize <= parentSize * 0.85) {
                previewPane.style.height = (newSize / parentSize) * 100 + '%';
            }
        } else {
            const diff = e.clientX - start;
            newSize = startSize + diff;
            const parentSize = mainContent.offsetWidth;
            if (newSize >= parentSize * 0.15 && newSize <= parentSize * 0.85) {
                previewPane.style.width = (newSize / parentSize) * 100 + '%';
            }
        }
    }

    function stopResize() {
        isResizing = false;
        document.body.classList.remove('resizing');
        document.removeEventListener('mousemove', doResize);
        document.removeEventListener('mouseup', stopResize);
    }

    document.body.classList.add('resizing');
    document.addEventListener('mousemove', doResize);
    document.addEventListener('mouseup', stopResize);
    e.preventDefault();
}

// --- Font Size Management ---
function increaseFontSize() {
    if (currentFontSize < 24) {
        currentFontSize += 2;
        updateFontSize();
    }
}

function decreaseFontSize() {
    if (currentFontSize > 10) {
        currentFontSize -= 2;
        updateFontSize();
    }
}

function updateFontSize() {
    document.documentElement.style.setProperty('--editor-font-size', currentFontSize + 'px');
    document.documentElement.style.setProperty('--preview-font-size', (currentFontSize) + 'px');
    document.getElementById('fontSizeDisplay').textContent = currentFontSize + 'px';
}

// --- Markdown and KaTeX Rendering ---
const renderer = new marked.Renderer();
let tocData = [];

// Custom renderer for ==highlight==
renderer.text = function(text) {
    return text.replace(/==(.*?)==/g, '<mark>$1</mark>');
};

// Custom renderer for headings to generate IDs for TOC
renderer.heading = function(text, level, rawtext) {
    const cleanText = rawtext.replace(/==(.*?)==/g, '$1').replace(/<[^>]*>/g, '');
    const id = cleanText.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
    tocData.push({ level, text: cleanText, id });
    return `<h${level} id="${id}">${text}</h${level}>`;
};

// Custom renderer for code blocks with line numbers
renderer.code = function(code, language) {
    if (language === 'math') {
        return `<p>${code}</p>`;
    }
    const finalCode = code.replace(/\n$/, '');
    const lines = finalCode.split('\n');
    const lineNumbers = lines.map((_, index) => (index + 1).toString()).join('\n');
    const highlightedCode = (language && hljs.getLanguage(language))
        ? hljs.highlight(finalCode, { language, ignoreIllegals: true }).value
        : hljs.highlightAuto(finalCode).value;
    
    return `<div class="code-block-wrapper"><div class="line-numbers">${lineNumbers}</div><pre class="code-content"><code class="hljs ${language ? 'language-' + language : ''}">${highlightedCode}</code></pre></div>`;
};

// Custom renderer for lists to fix numbering issues
renderer.list = function(body, ordered, start) {
    const type = ordered ? 'ol' : 'ul';
    const startatt = (ordered && start !== 1) ? ` start="${start}"` : '';
    return `<${type}${startatt}>\n${body}</${type}>\n`;
};

renderer.listitem = function(text, task, checked) {
    if (task) {
        const checkbox = checked ? '<input type="checkbox" checked disabled>' : '<input type="checkbox" disabled>';
        return `<li class="task-list-item">${checkbox} ${text}</li>\n`;
    }
    return `<li>${text}</li>\n`;
};

// Configure marked.js
marked.setOptions({
    renderer,
    breaks: true,
    gfm: true,
    tables: true,
    smartLists: true,
    pedantic: false,
    sanitize: false
});

function generateTOC() {
    if (tocData.length === 0) return '';
    let tocHtml = '<div class="toc"><div class="toc-title">📑 目录</div><ul>';
    let currentLevel = 1;
    tocData.forEach(item => {
        if (item.level > currentLevel) {
            tocHtml += '<ul>'.repeat(item.level - currentLevel);
        } else if (item.level < currentLevel) {
            tocHtml += '</ul>'.repeat(currentLevel - item.level);
        }
        tocHtml += `<li><a href="#${item.id}" onclick="scrollToSection('${item.id}'); return false;">${item.text}</a></li>`;
        currentLevel = item.level;
    });
    tocHtml += '</ul>'.repeat(currentLevel) + '</div>';
    return tocHtml;
}

function scrollToSection(id) {
    const element = document.getElementById(id);
    if (element) {
        element.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    }
}

function updatePreview() {
    if (isUpdatingFromHistory) return;

    let markdownText = editor.value;
    tocData = []; // Reset TOC data

    const mathBlocks = [];
    // Regex to find all math blocks: $$...$$ (multi-line) or $...$ (inline)
    const mathRegex = /(\$\$[\s\S]*?\$\$|\$[^\n\r$]+?\$)/g;

    // Temporarily replace math blocks with placeholders
    let placeholderText = markdownText.replace(mathRegex, (match) => {
        let processedMatch = match;
        
        // **This is the requested change:**
        // If a match starts with $$ but contains NO newlines, treat it as inline math.
        // We do this by converting it to a single-$ block before KaTeX sees it.
        if (match.startsWith('$$') && !match.includes('\n')) {
            processedMatch = '$' + match.substring(2, match.length - 2) + '$';
        }

        const index = mathBlocks.push(processedMatch) - 1;
        return `<!--MATH_BLOCK_${index}-->`;
    });

    // Parse the rest of the markdown
    let htmlContent = marked.parse(placeholderText);

    // Restore the math blocks from placeholders. This is more robust.
    htmlContent = htmlContent.replace(/<p>\s*<!--MATH_BLOCK_(\d+)-->\s*<\/p>|<!--MATH_BLOCK_(\d+)-->/g, (fullMatch, indexInP, indexInline) => {
        const index = parseInt(indexInP || indexInline, 10);
        return mathBlocks[index];
    });

    // Handle Table of Contents
    if (htmlContent.includes('[TOC]')) {
        const tocHtml = generateTOC();
        htmlContent = htmlContent.replace(/<p>\[TOC\]<\/p>|\[TOC\]/g, tocHtml);
    }
    
    preview.innerHTML = htmlContent;

    // Render all math using KaTeX
    if (window.renderMathInElement) {
        try {
            renderMathInElement(preview, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false}
                ],
                throwOnError: false,
                errorColor: '#cc0000',
                strict: false,
                trust: false,
                macros: {
                    "\\RR": "\\mathbb{R}",
                    "\\NN": "\\mathbb{N}",
                    "\\ZZ": "\\mathbb{Z}",
                    "\\QQ": "\\mathbb{Q}",
                    "\\CC": "\\mathbb{C}"
                }
            });
        } catch (e) {
            console.warn('KaTeX rendering error:', e);
        }
    }

    if (!isUpdatingFromHistory) {
        saveToHistory();
    }
}


// --- History (Undo/Redo) Management ---
function saveToHistory() {
    const currentContent = editor.value;
    if (historyIndex < history.length - 1) {
        history = history.slice(0, historyIndex + 1);
    }
    if (history.length === 0 || history[history.length - 1] !== currentContent) {
        history.push(currentContent);
        historyIndex = history.length - 1;
        if (history.length > 100) { // Limit history size
            history.shift();
            historyIndex--;
        }
    }
}

function undo() {
    if (historyIndex > 0) {
        historyIndex--;
        isUpdatingFromHistory = true;
        editor.value = history[historyIndex];
        updatePreview();
        isUpdatingFromHistory = false;
    }
}

function redo() {
    if (historyIndex < history.length - 1) {
        historyIndex++;
        isUpdatingFromHistory = true;
        editor.value = history[historyIndex];
        updatePreview();
        isUpdatingFromHistory = false;
    }
}

// --- File Operations ---
function newFile() {
    if (confirm('确定要新建文件吗？当前内容将会丢失。')) {
        editor.value = '';
        updatePreview();
        history = [];
        historyIndex = -1;
        saveToHistory();
    }
}

function importFile() { document.getElementById('fileInput').click(); }

function handleFileImport(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            editor.value = e.target.result;
            updatePreview();
            history = [];
            historyIndex = -1;
            saveToHistory();
        };
        reader.readAsText(file);
    }
    event.target.value = ''; // Reset file input
}

function exportFile() {
    const blob = new Blob([editor.value], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'document.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// --- Toolbar Button Handlers ---
function insertText(before, after = '', defaultText = '') {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const text = editor.value;
    const selectedText = text.substring(start, end) || defaultText;
    
    editor.focus();
    document.execCommand('insertText', false, before + selectedText + after);

    // Adjust selection
    const newStart = start + before.length;
    const newEnd = newStart + selectedText.length;
    editor.setSelectionRange(newStart, newEnd);

    updatePreview();
}

function insertBold() { insertText('**', '**', '粗体文本'); }
function insertItalic() { insertText('*', '*', '斜体文本'); }
function insertStrikethrough() { insertText('~~', '~~', '删除线文本'); }
function insertHighlight() { insertText('==', '==', '高亮文本'); }
function insertHeading(level) { if (level) insertText(`${'#'.repeat(level)} `, '', '标题'); }
function insertLink() { const url = prompt('请输入链接地址：', 'https://'); if (url) insertText('[', `](${url})`, '链接文本'); }
function insertImage() { const url = prompt('请输入图片地址：', 'https://'); if (url) insertText('![', `](${url})`, '图片描述'); }
function insertTable() { insertText('\n| 标题1 | 标题2 |\n|:---|:---|\n| 单元格 | 单元格 |\n'); }
function insertCode() { insertText('\n```javascript\n', '\n```\n', '代码内容'); }
function insertMath() { insertText('$$\n', '\n$$', 'E=mc^2'); }
function insertTOC() { insertText('\n[TOC]\n'); }
function insertQuote() { insertText('> ', '', '引用内容'); }
function insertUnorderedList() { insertText('\n- ', '', '列表项'); }
function insertOrderedList() { insertText('\n1. ', '', '列表项'); }
function insertTaskList() { insertText('\n- [ ] ', '', '任务项'); }
function insertHorizontalRule() { insertText('\n---\n'); }

// --- Event Listeners Setup ---
function setupEventListeners() {
    editor.addEventListener('input', updatePreview);
    
    editor.addEventListener('keydown', function(e) {
        // The problematic custom 'Enter' key handlers have been removed.
        // The default textarea behavior is more intuitive. The `breaks: true` 
        // option in marked.js will handle single line breaks correctly. 
        // Users can press Enter twice to create a paragraph, which is 
        // standard Markdown practice.

        // Handle standard shortcuts
        if (e.ctrlKey || e.metaKey) {
            switch (e.key.toLowerCase()) {
                case 'z':
                    e.preventDefault();
                    e.shiftKey ? redo() : undo();
                    break;
                case 'y':
                    e.preventDefault();
                    redo();
                    break;
                case 'b':
                    e.preventDefault();
                    insertBold();
                    break;
                case 'i':
                    e.preventDefault();
                    insertItalic();
                    break;
            }
        }
    });
}

// --- Initialization ---
function init() {
    const initialContent = `[TOC]
# Markdown 编辑器使用指南
在左侧编写你的 Markdown 内容，右侧实时预览。

- 支持**加粗**、*斜体*、~~删除线~~、代码块、表格等标准 Markdown 语法
- 支持行内公式 $E=mc^2$、块级公式（支持 KaTeX 渲染）
- 支持目录、任务列表、引用区块
- 支持一键导入、导出Markdown文件
- 常用快捷键：Ctrl+B（加粗）、Ctrl+I（斜体）、Ctrl+Z（撤销）

## 1. 换行说明

- **软换行 (新行):** 直接按 **Enter** 键。
- **段落 (硬换行):** 按两次 **Enter** 键，中间留一个空行。

这是第一段。

这是第二段，它们之间有一个空行。

## 2. 数学公式

### 行内公式
使用单个美元符号：质能方程是 $E=mc^2$。
现在，您也可以这样书写行内公式：$$E=mc^2$$，效果是相同的。

### 块级公式
只有当公式像下面这样，使用双美元符号包裹且公式主体单独成行时，才会被渲染为块级公式：

$$
\\int_a^b f(x) dx = F(b) - F(a)
$$

一个正确的行列式示例：
$$
\\begin{vmatrix}
a_1+b_1 & a_2+b_2 & a_3+b_3 \\\\
c_1 & c_2 & c_3 \\\\
d_1 & d_2 & d_3
\\end{vmatrix}
=
\\begin{vmatrix}
a_1 & a_2 & a_3 \\\\
c_1 & c_2 & c_3 \\\\
d_1 & d_2 & d_3
\\end{vmatrix}
+
\\begin{vmatrix}
b_1 & b_2 & b_3 \\\\
c_1 & c_2 & c_3 \\\\
d_1 & d_2 & d_3
\\end{vmatrix}
$$

## 3. 列表示例

### 无序列表
- 第一项
- 第二项
  - 嵌套项目
- 第三项

### 有序列表
1. 第一步
2. 第二步
   1. 子步骤一

### 任务列表
- [x] 已完成任务
- [ ] 未完成任务

## 4. 其他功能

> 这是一个引用块。

\`\`\`javascript
// 这是代码块
function hello() {
    console.log("Hello, World!");
}
\`\`\`

| 表头1 | 表头2 |
|:------|:-----:|
| 左对齐 | 居中 |

---

现在您可以开始使用这个编辑器了！
`;
    
    editor.value = initialContent;
    setupEventListeners();
    updatePreview();
    saveToHistory();
    updateFontSize();
}
