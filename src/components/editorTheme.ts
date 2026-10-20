import type { EditorThemeClasses } from 'lexical'

export const editorTheme: EditorThemeClasses = {
  paragraph: 'mb-2 leading-relaxed',
  heading: {
    h1: 'mb-4 mt-6 text-3xl font-semibold',
    h2: 'mb-3 mt-5 text-2xl font-semibold',
    h3: 'mb-2 mt-4 text-xl font-semibold',
  },
  list: {
    ul: 'mb-3 ml-5 list-disc',
    ol: 'mb-3 ml-5 list-decimal',
    listitem: 'ml-2 mb-1',
    nested: {
      listitem: 'ml-4',
    },
  },
  quote: 'mb-3 border-l-4 border-slate-300 pl-4 italic text-slate-500 dark:border-slate-600 dark:text-slate-400',
  code: 'mb-3 block overflow-x-auto rounded-lg bg-slate-100 p-3 font-mono text-sm text-slate-900 dark:bg-slate-800 dark:text-slate-100',
  text: {
    bold: 'font-bold',
    italic: 'italic',
    underline: 'underline',
    strikethrough: 'line-through',
    code: 'rounded bg-slate-100 px-1 py-0.5 font-mono text-sm text-slate-900 dark:bg-slate-800 dark:text-slate-100',
  },
}
