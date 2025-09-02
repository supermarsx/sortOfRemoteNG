import { Connection } from '../types/connection';

export interface DragDropResult {
  draggedId: string;
  targetId: string | null;
  position: 'before' | 'after' | 'inside';
}

/**
 * Manages drag-and-drop interactions for connection items.
 * The manager toggles DOM classes to display visual drop indicators
 * and produces ordered connection arrays after a drop occurs.
 *
 * Usage example:
 * ```ts
 * const manager = new DragDropManager();
 * element.addEventListener('dragstart', () => manager.startDrag(conn, element));
 * ```
 */
export class DragDropManager {
  private draggedConnection: Connection | null = null;
  private dragOverElement: HTMLElement | null = null;

  /**
   * Begin dragging a connection element. The element is marked as draggable
   * and made semi-transparent to show it is in a drag state.
   * @param connection The connection being dragged.
   * @param element The DOM element representing the connection.
   */
  startDrag(connection: Connection, element: HTMLElement): void {
    // Store a reference to the dragged connection for later use
    this.draggedConnection = connection;

    // Apply visual cues and enable HTML5 drag events on the element
    element.style.opacity = '0.5';
    element.setAttribute('draggable', 'true');
  }

  /**
   * Handle a dragover event on potential drop targets. This updates visual
   * indicators that hint at where the dragged item will be placed.
   * @param event The dragover DOM event.
   * @param targetConnection The connection currently under the cursor.
   */
  handleDragOver(event: DragEvent, targetConnection: Connection): void {
    // Allow dropping by preventing the default dragover behavior
    event.preventDefault();

    // Ignore if nothing is being dragged or hovering over the dragged element
    if (!this.draggedConnection || this.draggedConnection.id === targetConnection.id) {
      return;
    }

    const element = event.currentTarget as HTMLElement;
    const rect = element.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const height = rect.height;

    // Remove any previously shown drop indicators
    this.clearDropIndicators();

    // Determine where the drop indicator should appear relative to the target
    if (targetConnection.isGroup) {
      // Groups allow dropping before, after, or as a child
      if (y < height * 0.25) {
        this.showDropIndicator(element, 'before');
      } else if (y > height * 0.75) {
        this.showDropIndicator(element, 'after');
      } else {
        this.showDropIndicator(element, 'inside');
      }
    } else {
      // Regular connections only allow dropping before or after
      if (y < height * 0.5) {
        this.showDropIndicator(element, 'before');
      } else {
        this.showDropIndicator(element, 'after');
      }
    }

    // Remember the element currently being hovered so indicators can be cleared later
    this.dragOverElement = element;
  }

  /**
   * Finalize a drop operation and return the resulting move description.
   * @param event The drop event from the browser.
   * @param targetConnection The connection onto which the item was dropped.
   * @returns Details about the drag source, drop target and relative position.
   */
  handleDrop(event: DragEvent, targetConnection: Connection): DragDropResult | null {
    // Prevent default to ensure the drop event is processed
    event.preventDefault();

    // Abort if we lost track of the dragged connection or dropped onto itself
    if (!this.draggedConnection || this.draggedConnection.id === targetConnection.id) {
      return null;
    }

    const element = event.currentTarget as HTMLElement;
    const rect = element.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const height = rect.height;

    let position: 'before' | 'after' | 'inside';

    // Choose the drop position based on cursor location within the target
    if (targetConnection.isGroup) {
      if (y < height * 0.25) {
        position = 'before';
      } else if (y > height * 0.75) {
        position = 'after';
      } else {
        position = 'inside';
      }
    } else {
      position = y < height * 0.5 ? 'before' : 'after';
    }

    // Package the information needed to update connection order
    const result: DragDropResult = {
      draggedId: this.draggedConnection.id,
      targetId: targetConnection.id,
      position,
    };

    // Clean up temporary drag state and styles
    this.endDrag();
    return result;
  }

  /**
   * Clear any drag-related state and DOM changes after an operation completes
   * or is cancelled.
   */
  endDrag(): void {
    // Remove any lingering drop indicators from the document
    this.clearDropIndicators();

    if (this.draggedConnection) {
      // Restore the original appearance of the dragged element
      const draggedElement = document.querySelector(
        `[data-connection-id="${this.draggedConnection.id}"]`
      ) as HTMLElement;
      if (draggedElement) {
        draggedElement.style.opacity = '1';
        draggedElement.removeAttribute('draggable');
      }
    }

    // Reset references to indicate no active drag operation
    this.draggedConnection = null;
    this.dragOverElement = null;
  }

  private showDropIndicator(element: HTMLElement, position: 'before' | 'after' | 'inside'): void {
    element.classList.remove('drop-before', 'drop-after', 'drop-inside');
    element.classList.add(`drop-${position}`);
  }

  private clearDropIndicators(): void {
    document.querySelectorAll('.drop-before, .drop-after, .drop-inside').forEach(element => {
      element.classList.remove('drop-before', 'drop-after', 'drop-inside');
    });
  }

  /**
   * Apply the drag-and-drop result to the connection list, returning a new
   * ordered array with updated parent relationships.
   * @param result Description of the completed drag operation.
   * @param connections Existing connections before reordering.
   * @returns A new array reflecting the moved connection.
   */
  processDropResult(
    result: DragDropResult,
    connections: Connection[]
  ): Connection[] {
    // Locate the moved connection so we can reinsert it
    const draggedConnection = connections.find(c => c.id === result.draggedId);
    if (!draggedConnection) {
      return connections;
    }

    // Remove the dragged item from its original position
    const updatedConnections = connections.filter(c => c.id !== result.draggedId);

    // Determine the new parent and insertion index
    let newParentId: string | undefined;
    let insertIndex = 0;

    if (result.targetId === null) {
      // Dropping on the root level places it at the end
      newParentId = undefined;
      insertIndex = updatedConnections.length;
    } else {
      const targetConnection = connections.find(c => c.id === result.targetId);

      if (!targetConnection) {
        return connections;
      }

      // Groups accept children when dropped inside; otherwise inherit target's parent
      if (result.position === 'inside' && targetConnection.isGroup) {
        newParentId = targetConnection.id;
      } else {
        newParentId = targetConnection.parentId;
      }

      if (result.position === 'inside') {
        // Insert at the beginning of the target group's children
        const targetChildren = updatedConnections.filter(c => c.parentId === targetConnection.id);
        if (targetChildren.length > 0) {
          insertIndex = updatedConnections.indexOf(targetChildren[0]);
        } else {
          insertIndex = updatedConnections.indexOf(targetConnection) + 1;
        }
      } else {
        const targetIndex = updatedConnections.indexOf(targetConnection);
        insertIndex = result.position === 'before' ? targetIndex : targetIndex + 1;
      }
    }

    // Create a new instance of the dragged connection with updated metadata
    const updatedDraggedConnection: Connection = {
      ...draggedConnection,
      parentId: newParentId,
      updatedAt: new Date(),
    };

    // Insert the connection into its new location
    updatedConnections.splice(insertIndex, 0, updatedDraggedConnection);

    return updatedConnections;
  }
}
