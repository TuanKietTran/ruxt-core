import { onBeforeUnmount, onMounted, shallowRef, toValue, watch } from "vue";
import type { MaybeRefOrGetter, ShallowRef } from "vue";
import { Compartment, EditorState, StateEffect, StateField, Transaction } from "@codemirror/state";
import type { Extension, Range } from "@codemirror/state";
import {
    Decoration,
    type DecorationSet,
    EditorView,
    ViewPlugin,
    highlightActiveLine,
    highlightActiveLineGutter,
    keymap,
    lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
    bracketMatching,
    defaultHighlightStyle,
    HighlightStyle,
    indentOnInput,
    syntaxHighlighting,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";

export type CodeMirrorLanguage = "markdown" | "css";
export type MarkdownFormat = "bold" | "italic" | "link" | "heading" | "quote" | "bullet" | "code";

export interface EditorStats {
    line: number;
    column: number;
    words: number;
}

/** A source range marked by the host, e.g. a detected profile value. */
export interface CodeMirrorHighlight {
    from: number;
    to: number;
    /** Extra classes on the mark; `cm-source-highlight` is always applied. */
    class?: string;
    title?: string;
}

export interface UseCodeMirrorOptions {
    initialDoc: MaybeRefOrGetter<string>;
    language?: MaybeRefOrGetter<CodeMirrorLanguage>;
    readOnly?: MaybeRefOrGetter<boolean>;
    highlights?: MaybeRefOrGetter<readonly CodeMirrorHighlight[] | undefined>;
    onChange?: (state: EditorState) => void;
    onStatsChange?: (stats: EditorStats) => void;
}

export interface UseCodeMirrorResult<T extends HTMLElement> {
    container: ShallowRef<T | null>;
    view: ShallowRef<EditorView | undefined>;
    setDocument: (document: string) => void;
    applyMarkdownFormat: (format: MarkdownFormat) => void;
    focus: () => void;
    revealRange: (from: number, to?: number) => void;
}

export const transparentTheme = EditorView.theme({
    "&": {
        backgroundColor: "transparent !important",
        height: "100%",
    },
    ".cm-scroller": {
        overflow: "auto",
    },
});

const markdownHeadingStyle = HighlightStyle.define([
    { tag: tags.heading1, fontSize: "1.6em", fontWeight: "bold" },
    { tag: tags.heading2, fontSize: "1.4em", fontWeight: "bold" },
    { tag: tags.heading3, fontSize: "1.2em", fontWeight: "bold" },
]);

const markdownIndicatorDecorations = (view: EditorView) => {
    const ranges: Range<Decoration>[] = [];
    const attributePattern = /\{(?:[.#][\w-]+(?:\s+|(?=\}))){1,}\}/g;
    const directivePattern = /:::(?:[\w-]+(?:\{[^{}]*\})?)?\s*$/;
    for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber++) {
        const line = view.state.doc.line(lineNumber);
        const directive = line.text.match(directivePattern);
        if (directive) {
            const from = line.from + (directive.index ?? 0);
            ranges.push(Decoration.mark({ class: "cm-markdown-indicator" }).range(from, line.to));
            continue;
        }
        for (const match of line.text.matchAll(attributePattern)) {
            const from = line.from + (match.index ?? 0);
            ranges.push(Decoration.mark({ class: "cm-markdown-indicator" }).range(from, from + match[0].length));
        }
    }
    return Decoration.set(ranges, true);
};

const markdownIndicators = ViewPlugin.fromClass(class {
    decorations;
    constructor(view: EditorView) { this.decorations = markdownIndicatorDecorations(view); }
    update(update: { docChanged: boolean; viewportChanged: boolean; view: EditorView }) {
        if (update.docChanged || update.viewportChanged) this.decorations = markdownIndicatorDecorations(update.view);
    }
}, { decorations: value => value.decorations });

const setSourceHighlights = StateEffect.define<readonly CodeMirrorHighlight[]>();

const buildSourceHighlights = (highlights: readonly CodeMirrorHighlight[], length: number): DecorationSet =>
    Decoration.set(
        highlights
            .filter(highlight => highlight.from >= 0 && highlight.from < highlight.to && highlight.to <= length)
            .map(highlight => Decoration.mark({
                class: highlight.class ? `cm-source-highlight ${highlight.class}` : "cm-source-highlight",
                attributes: highlight.title ? { title: highlight.title } : undefined,
            }).range(highlight.from, highlight.to)),
        true,
    );

// Host highlights follow edits until the host replaces them.
const sourceHighlights = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, transaction) {
        let next = value.map(transaction.changes);
        for (const effect of transaction.effects) {
            if (effect.is(setSourceHighlights)) next = buildSourceHighlights(effect.value, transaction.state.doc.length);
        }
        return next;
    },
    provide: field => EditorView.decorations.from(field),
});

const languageExtensions = (language: CodeMirrorLanguage): Extension =>
    language === "css"
        ? css()
        : [
              markdown({
                  base: markdownLanguage,
                  codeLanguages: languages,
                  addKeymap: true,
              }),
              syntaxHighlighting(markdownHeadingStyle),
          ];

export function useCodeMirror<T extends HTMLElement = HTMLDivElement>(
    options: UseCodeMirrorOptions,
): UseCodeMirrorResult<T> {
    const container = shallowRef<T | null>(null) as ShallowRef<T | null>;
    const view = shallowRef<EditorView>();
    const reportStats = (state: EditorState) => {
        if (!options.onStatsChange) return;
        const head = state.selection.main.head;
        const line = state.doc.lineAt(head);
        options.onStatsChange({
            line: line.number,
            column: head - line.from + 1,
            words: state.doc.toString().split(/\s+/).filter(Boolean).length,
        });
    };
    const languageCompartment = new Compartment();
    const readOnlyCompartment = new Compartment();
    const historyCompartment = new Compartment();
    let settingDocument = false;

    const setDocument = (document: string) => {
        const currentView = view.value;
        if (!currentView || currentView.state.doc.toString() === document) return;

        settingDocument = true;
        try {
            currentView.dispatch({
                changes: {
                    from: 0,
                    to: currentView.state.doc.length,
                    insert: document,
                },
                annotations: Transaction.addToHistory.of(false),
            });
        } finally {
            settingDocument = false;
        }
        // A full replacement collapses mapped highlights; re-apply them to the new text.
        applyHighlights();
    };

    const focus = () => view.value?.focus();

    const applyHighlights = () => {
        view.value?.dispatch({ effects: setSourceHighlights.of(toValue(options.highlights) ?? []) });
    };

    const revealRange = (from: number, to = from) => {
        const currentView = view.value;
        if (!currentView) return;
        const length = currentView.state.doc.length;
        const anchor = Math.min(Math.max(0, from), length);
        const head = Math.min(Math.max(anchor, to), length);
        currentView.dispatch({
            selection: { anchor, head },
            effects: EditorView.scrollIntoView(anchor, { y: "center" }),
        });
        currentView.focus();
    };

    const applyMarkdownFormat = (format: MarkdownFormat) => {
        const currentView = view.value;
        if (!currentView || toValue(options.language ?? "markdown") !== "markdown") return;

        const range = currentView.state.selection.main;
        const selected = currentView.state.sliceDoc(range.from, range.to);
        let insert = selected;
        let anchor = range.from;
        let head = range.from;

        if (format === "bold" || format === "italic" || format === "code") {
            const marker = format === "bold" ? "**" : format === "italic" ? "_" : "`";
            insert = `${marker}${selected}${marker}`;
            anchor = range.from + marker.length;
            head = anchor + selected.length;
        } else if (format === "link") {
            const label = selected || "text";
            insert = `[${label}](url)`;
            anchor = selected ? range.from + insert.length - 4 : range.from + 1;
            head = selected ? anchor + 3 : anchor + label.length;
        } else {
            const marker = format === "heading" ? "## " : format === "quote" ? "> " : "- ";
            const line = currentView.state.doc.lineAt(range.from);
            const from = line.from;
            const to = range.empty
                ? line.to
                : currentView.state.doc.lineAt(Math.max(range.from, range.to - 1)).to;
            const text = currentView.state.sliceDoc(from, to);
            insert = text.split("\n").map((part) => `${marker}${part}`).join("\n");
            anchor = from + marker.length;
            head = from + insert.length;
            currentView.dispatch({ changes: { from, to, insert }, selection: { anchor, head } });
            currentView.focus();
            return;
        }

        currentView.dispatch({
            changes: { from: range.from, to: range.to, insert },
            selection: { anchor, head },
        });
        currentView.focus();
    };

    onMounted(() => {
        if (!container.value) return;

        const startState = EditorState.create({
            doc: toValue(options.initialDoc),
            extensions: [
                keymap.of([...defaultKeymap, ...historyKeymap]),
                lineNumbers(),
                highlightActiveLineGutter(),
                historyCompartment.of(history()),
                indentOnInput(),
                bracketMatching(),
                syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
                highlightActiveLine(),
                languageCompartment.of(
                    languageExtensions(toValue(options.language ?? "markdown")),
                ),
                readOnlyCompartment.of([
                    EditorState.readOnly.of(toValue(options.readOnly ?? false)),
                    EditorView.editable.of(!toValue(options.readOnly ?? false)),
                ]),
                oneDark,
                transparentTheme,
                EditorView.lineWrapping,
                markdownIndicators,
                sourceHighlights,
                EditorView.updateListener.of((update) => {
                    if (update.docChanged && !settingDocument) options.onChange?.(update.state);
                    if (update.docChanged || update.selectionSet) reportStats(update.state);
                }),
            ],
        });

        view.value = new EditorView({
            state: startState,
            parent: container.value,
        });
        reportStats(view.value.state);
        applyHighlights();
    });

    watch(() => toValue(options.highlights), applyHighlights);

    watch(
        () => toValue(options.initialDoc),
        (document) => setDocument(document),
    );

    watch(
        () => toValue(options.readOnly ?? false),
        (readOnly) => {
            view.value?.dispatch({
                effects: readOnlyCompartment.reconfigure([
                    EditorState.readOnly.of(readOnly),
                    EditorView.editable.of(!readOnly),
                ]),
            });
        },
    );

    watch(
        () => toValue(options.language ?? "markdown"),
        (language) => {
            view.value?.dispatch({
                effects: [
                    languageCompartment.reconfigure(languageExtensions(language)),
                    // Markdown and CSS share a view, but must never share undo history.
                    historyCompartment.reconfigure(history()),
                ],
            });
        },
    );

    onBeforeUnmount(() => {
        view.value?.destroy();
        view.value = undefined;
    });

    return { container, view, setDocument, applyMarkdownFormat, focus, revealRange };
}

export default useCodeMirror;
