<script setup lang="ts">
import { toRef } from "vue";
import { useCodeMirror } from "../composables/useCodeMirror";
import type { CodeMirrorHighlight, CodeMirrorLanguage, EditorStats } from "../composables/useCodeMirror";

const props = withDefaults(
    defineProps<{
        modelValue: string;
        language?: CodeMirrorLanguage;
        readOnly?: boolean;
        showIndicators?: boolean;
        highlights?: readonly CodeMirrorHighlight[];
    }>(),
    {
        language: "markdown",
        readOnly: false,
        showIndicators: true,
    },
);

const emit = defineEmits<{
    "update:modelValue": [value: string];
    "update:stats": [stats: EditorStats];
}>();

const { container, applyMarkdownFormat, focus, revealRange } = useCodeMirror({
    initialDoc: toRef(props, "modelValue"),
    language: toRef(props, "language"),
    readOnly: toRef(props, "readOnly"),
    highlights: toRef(props, "highlights"),
    onChange: (state) => emit("update:modelValue", state.doc.toString()),
    onStatsChange: (stats) => emit("update:stats", stats),
});

defineExpose({ applyMarkdownFormat, focus, revealRange });
</script>

<template>
    <div
        ref="container"
        class="code-mirror"
        :class="{ 'code-mirror--hide-indicators': language === 'markdown' && !showIndicators }"
    />
</template>

<style scoped>
.code-mirror {
    width: 100%;
    height: 100%;
    min-height: 0;
}

.code-mirror :deep(.cm-editor) {
    height: 100%;
    font-size: 13px;
}

.code-mirror :deep(.cm-markdown-indicator) {
    color: var(--fg-overlay0);
    font-size: .9em;
    font-weight: 500;
}

.code-mirror--hide-indicators :deep(.cm-markdown-indicator) {
    visibility: hidden;
}

.code-mirror :deep(.cm-source-highlight) {
    border-radius: 2px;
    background: color-mix(in srgb, var(--highlight-color, var(--accent, #89b4fa)) 22%, transparent);
    box-shadow: inset 0 -1px 0 var(--highlight-color, var(--accent, #89b4fa));
}

.code-mirror :deep(.cm-source-highlight--active) {
    background: color-mix(in srgb, var(--highlight-color, var(--accent, #89b4fa)) 45%, transparent);
    outline: 1px solid var(--highlight-color, var(--accent, #89b4fa));
}

.code-mirror :deep(.cm-scroller) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
</style>
