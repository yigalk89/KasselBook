"use client";

import { useEffect, useState } from "react";

type TreeNode = {
  name: string;
  spousePairs?: { husband: string; wife: string }[];
  children?: TreeNode[];
};

function TreeNodeView({ node }: { node: TreeNode }) {
  return (
    <li>
      <div className="node-card">
        {node.spousePairs && node.spousePairs.length > 0 ? (
          <div className="couple-list">
            {node.spousePairs.map((pair) => (
              <div
                key={`${node.name}-${pair.husband}-${pair.wife}`}
                className="couple-row"
              >
                <span className="couple-pill">{pair.husband}</span>
                <span className="couple-pill">{pair.wife}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="node-name">{node.name}</div>
        )}
      </div>
      {node.children && node.children.length > 0 ? (
        <ul>
          {node.children.map((child) => (
            <TreeNodeView key={`${node.name}-${child.name}`} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function FamilyTree({ rootName }: { rootName: string }) {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadTree() {
      setError(null);
      try {
        const response = await fetch(
          `/api/family-tree?root=${encodeURIComponent(rootName)}`,
          { cache: "no-store" }
        );

        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || "Failed to fetch family tree.");
        }

        const data = (await response.json()) as { tree: TreeNode | null };
        if (!cancelled) setTree(data.tree);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to fetch family tree.");
        }
      }
    }

    loadTree();

    return () => {
      cancelled = true;
    };
  }, [rootName]);

  if (error) {
    return <p className="text-sm text-foreground/70">{error}</p>;
  }

  if (!tree) {
    return <p className="text-sm text-foreground/70">Loading family tree...</p>;
  }

  return (
    <ul>
      <TreeNodeView node={tree} />
    </ul>
  );
}
