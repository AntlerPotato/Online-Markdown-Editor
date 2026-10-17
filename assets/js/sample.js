// Document shown on first visit (before anything has been autosaved).
(function (MDE) {
    MDE.sampleDocument = `[TOC]
# Markdown 编辑器使用指南
在右侧编写你的 Markdown 内容，左侧实时预览。

- 支持**加粗**、*斜体*、~~删除线~~、==高亮==、代码块、表格等标准 Markdown 语法
- 支持行内公式 $E=mc^2$、块级公式（支持 KaTeX 渲染）
- 支持目录、任务列表、引用区块
- 支持一键导入、导出 Markdown 文件，内容会自动保存在浏览器中
- 常用快捷键：Ctrl+B（加粗）、Ctrl+I（斜体）、Ctrl+K（链接）、Ctrl+Z（撤销）

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
})(window.MDE = window.MDE || {});
