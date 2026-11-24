"use client";

import { useState } from "react";
import { BoardTree } from "@/components/BoardTree";
import { getBrowserClient } from "@/lib/supabase/client";
import { useProjectEvents } from "@/hooks/useProjectEvents";
import type { TreeNode } from "@/lib/types";

export function ProjectLive({
  projectId,
  initialNodes,
  isTeacher,
}: {
  projectId: string;
  initialNodes: TreeNode[];
  isTeacher: boolean;
}) {
  const [nodes, setNodes] = useState(initialNodes);
  const [prevInitial, setPrevInitial] = useState(initialNodes);
  if (prevInitial !== initialNodes) {
    setPrevInitial(initialNodes);
    setNodes(initialNodes);
  }
  useProjectEvents(projectId, async (evs) => {
    if (!evs.some((e) => e.scope === "structure")) return;
    const { data } = await getBrowserClient().rpc("get_board_tree", { p_project: projectId });
    if (data) setNodes(data as TreeNode[]);
  });
  return <BoardTree projectId={projectId} nodes={nodes} isTeacher={isTeacher} />;
}
