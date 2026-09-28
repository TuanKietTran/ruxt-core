<script setup lang="ts">
import { computed } from "vue";
import postcss from "postcss";
import prefixSelector from "postcss-prefix-selector";
import "github-markdown-css/github-markdown.css";
import { renderCvMarkdownToHtml, splitCvSheets } from "../utils/cvMarkdown";

const props = withDefaults(defineProps<{
    doc: string;
    css?: string;
}>(), {
    css: "",
});

const html = computed(() => renderCvMarkdownToHtml(props.doc));
const scopedCss = computed(() => {
    try {
        return postcss([
            {
                postcssPlugin: "cv-remove-global-at-rules",
                AtRule(rule) {
                    // These rules cannot be limited to the preview subtree. In particular,
                    // @import would load an entirely unprefixed global stylesheet.
                    if ([
                        "import", "namespace", "page", "property", "font-face",
                        "font-feature-values", "counter-style", "keyframes", "-webkit-keyframes",
                        "layer",
                    ].includes(rule.name.toLowerCase())) {
                        rule.remove();
                    }
                },
            },
            prefixSelector({
                prefix: ".cv-preview-scope",
                transform(prefix, selector, prefixedSelector) {
                    if (/^(?::root|html|body)(?:\b|\s|\.|#|:|\[)/.test(selector)) {
                        return selector.replace(/^(?::root|html|body)/, prefix);
                    }
                    return prefixedSelector;
                },
            }),
        ]).process(props.css, { from: undefined }).css;
    } catch {
        return "";
    }
});
const styleElement = useTemplateRef<HTMLStyleElement>("documentStyle");
const applyDocumentStyle = () => {
    if (styleElement.value) styleElement.value.textContent = scopedCss.value;
};
onMounted(applyDocumentStyle);
watch(scopedCss, applyDocumentStyle);

const pages = computed(() => splitCvSheets(html.value));
</script>

<template>
    <div class="code-preview cv-preview-scope">
        <!-- Set through textContent so quotes remain valid CSS without allowing HTML injection. -->
        <component :is="'style'" ref="documentStyle" />
        <!-- Markdown HTML is sanitized before reaching v-html. -->
        <article
            v-for="(page, index) in pages"
            :key="index"
            class="cv-sheet"
            :aria-label="`CV page ${index + 1}`"
            v-html="page"
        />
    </div>
</template>

<style scoped>
.code-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 28px;
    min-width: max-content;
}

.cv-sheet {
    flex: none;
    box-shadow: 0 4px 18px rgb(0 0 0 / 20%);
}

@media print {
    .code-preview {
        display: block;
        min-width: 0;
        print-color-adjust: exact;
    }

    .cv-sheet + .cv-sheet {
        break-before: page;
        page-break-before: always;
    }
}
</style>
