import { useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { CategoryForm } from "../forms/category-form";
import { useUpdateCategoryMutation } from "../hooks/use-catalog-taxonomy";
import type {
  CategoryOption,
  CategoryTreeNode,
  UpdateCategoryInput,
} from "../types/catalog-taxonomy.types";

/** Flattens one category tree into parent-select options while preserving hierarchy depth. */
export function flattenCategoryTree(
  nodes: CategoryTreeNode[],
  depth = 0,
): CategoryOption[] {
  return nodes.flatMap((node) => [
    { id: node.id, label: node.name, status: node.status, depth },
    ...flattenCategoryTree(node.children, depth + 1),
  ]);
}

/** Collects one category ID plus every descendant ID so the editor can hide obvious cycle choices. */
function collectCategoryBranchIds(node: CategoryTreeNode): Set<string> {
  const ids = new Set<string>([node.id]);
  for (const child of node.children) {
    for (const id of collectCategoryBranchIds(child)) ids.add(id);
  }
  return ids;
}

/** Renders one editable category node and recursively renders its children. */
function CategoryNodeEditor({
  node,
  parentOptions,
}: {
  node: CategoryTreeNode;
  parentOptions: CategoryOption[];
}) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateCategoryMutation(node.id);

  /** Saves one category edit and closes the inline editor after the server accepts it. */
  async function save(input: UpdateCategoryInput): Promise<void> {
    await update.mutateAsync(input);
    setEditing(false);
  }

  return (
    <li className="space-y-3">
      <div className="rounded-card border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{node.name}</h3>
              <StatusPill tone={node.status === "active" ? "positive" : "neutral"}>
                {node.status}
              </StatusPill>
            </div>
            <p className="mt-1 text-xs text-foreground-muted">
              /{node.slug} · sort {node.sortOrder}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setEditing((value) => !value)}>
            {editing ? "Close editor" : "Edit category"}
          </Button>
        </div>
        {editing ? (
          <div className="mt-4 border-t border-border pt-4">
            <CategoryForm
              category={node}
              parentOptions={parentOptions}
              excludedParentIds={collectCategoryBranchIds(node)}
              submitLabel="Save category"
              isPending={update.isPending}
              error={update.error}
              onSubmit={save}
            />
          </div>
        ) : null}
      </div>

      {node.children.length > 0 ? (
        <ul className="ml-4 space-y-3 border-l border-border-strong pl-4 md:ml-6 md:pl-5">
          {node.children.map((child) => (
            <CategoryNodeEditor key={child.id} node={child} parentOptions={parentOptions} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Renders the complete category hierarchy with one simple inline editor per node. */
export function CategoryTreeEditor({ nodes }: { nodes: CategoryTreeNode[] }) {
  const parentOptions = flattenCategoryTree(nodes);
  return (
    <ul className="space-y-3">
      {nodes.map((node) => (
        <CategoryNodeEditor key={node.id} node={node} parentOptions={parentOptions} />
      ))}
    </ul>
  );
}
