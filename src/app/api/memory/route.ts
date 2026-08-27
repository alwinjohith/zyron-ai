import { NextResponse } from "next/server";
import {
  createMemory,
  getAllMemories,
  deleteMemory,
  clearAllMemories,
  updateMemory,
  getMemoriesByCategory,
  categorizeMemory,
} from "@/lib/db";

/**
 * GET /api/memory
 * Returns all stored memories.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");

    const memories = category
      ? getMemoriesByCategory(category)
      : getAllMemories();

    return NextResponse.json({ success: true, memories });
  } catch (error) {
    console.error("Failed to fetch memories:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch memories" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/memory
 * Create a new memory.
 * Body: { content: string, category?: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { content, category } = body;

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "Memory content is required" },
        { status: 400 }
      );
    }

    const memory = createMemory(content.trim(), category || categorizeMemory(content));
    return NextResponse.json({ success: true, memory }, { status: 201 });
  } catch (error) {
    console.error("Failed to create memory:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create memory" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/memory
 * Update an existing memory.
 * Body: { id: number, content: string, category?: string }
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { id, content, category } = body;

    if (id === undefined || typeof id !== "number") {
      return NextResponse.json(
        { success: false, error: "Memory id is required" },
        { status: 400 }
      );
    }

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "Memory content is required" },
        { status: 400 }
      );
    }

    if (category !== undefined && typeof category !== "string") {
      return NextResponse.json(
        { success: false, error: "Category must be a string" },
        { status: 400 }
      );
    }

    const updated = updateMemory(id, content.trim(), category);
    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Memory not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, memory: updated });
  } catch (error) {
    console.error("Failed to update memory:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update memory" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/memory
 * Delete a single memory or clear all memories.
 * Body: { id?: number } - deletes a specific memory
 * Body: { clearAll: true } - clears all memories
 */
export async function DELETE(request: Request) {
  try {
    const body = await request.json();

    // Clear all memories
    if (body.clearAll === true) {
      const count = clearAllMemories();
      return NextResponse.json({
        success: true,
        message: `Cleared ${count} memories`,
      });
    }

    // Delete a specific memory
    if (body.id && typeof body.id === "number") {
      const deleted = deleteMemory(body.id);
      if (!deleted) {
        return NextResponse.json(
          { success: false, error: "Memory not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ success: true, message: "Memory deleted" });
    }

    return NextResponse.json(
      { success: false, error: "Provide an id or clearAll: true" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Failed to delete memory:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete memory" },
      { status: 500 }
    );
  }
}
