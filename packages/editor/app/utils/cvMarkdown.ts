import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Options as SanitizeSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";

const sanitizeSchema = {
    ...defaultSchema,
    attributes: {
        ...defaultSchema.attributes,
        "*": [...(defaultSchema.attributes?.["*"] ?? []), "className", "id"],
        code: [...(defaultSchema.attributes?.code ?? []), "className"],
    },
} satisfies SanitizeSchema;

const markdownIndicators = () => (tree: any) => {
    const visit = (node: any) => {
        if (node.type === "containerDirective") {
            node.data ??= {};
            node.data.hName = "div";
            node.data.hProperties = {
                ...(node.attributes ?? {}),
                className: [node.name, ...(node.attributes?.class ? String(node.attributes.class).split(/\s+/) : [])],
            };
        }

        if ((node.type === "heading" || node.type === "paragraph") && node.children?.length) {
            const tail = node.children[node.children.length - 1];
            if (tail.type === "text") {
                const match = tail.value.match(/\s*\{([^{}]+)\}\s*$/);
                if (match) {
                    const classes: string[] = [];
                    const properties: Record<string, string | string[]> = {};
                    for (const token of match[1].trim().split(/\s+/)) {
                        if (token.startsWith(".")) classes.push(token.slice(1));
                        else if (token.startsWith("#")) properties.id = token.slice(1);
                    }
                    if (classes.length || properties.id) {
                        tail.value = tail.value.slice(0, match.index).trimEnd();
                        node.data ??= {};
                        node.data.hProperties = { ...(node.data.hProperties ?? {}), ...properties, className: classes };
                    }
                }
            }
        }
        node.children?.forEach(visit);
    };
    visit(tree);
};

const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(markdownIndicators)
    .use(remarkRehype)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify);

export function renderCvMarkdownToHtml(markdown: string): string {
    return processor.processSync(markdown).toString();
}

export function splitCvSheets(html: string): string[] {
    const split = html.split(/<hr\s*\/?>(?:\n)?/i);
    return split.filter((page) => page.trim().length > 0);
}
