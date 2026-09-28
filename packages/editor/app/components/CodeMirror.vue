<script setup lang="ts">
import { toRef } from "vue";
import { useCodeMirror } from "../composables/useCodeMirror";
import type { CodeMirrorLanguage, EditorStats } from "../composables/useCodeMirror";

const props = withDefaults(
    defineProps<{
        modelValue: string;
        language?: CodeMirrorLanguage;
        readOnly?: boolean;
        showIndicators?: boolean;
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

const { container, applyMarkdownFormat, focus } = useCodeMirror({
    initialDoc: toRef(props, "modelValue"),
    language: toRef(props, "language"),
    readOnly: toRef(props, "readOnly"),
    onChange: (state) => emit("update:modelValue", state.doc.toString()),
    onStatsChange: (stats) => emit("update:stats", stats),
});

defineExpose({ applyMarkdownFormat, focus });
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

.code-mirror :deep(.cm-scroller) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
</style>
