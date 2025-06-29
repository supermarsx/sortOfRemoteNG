import { Connection } from '../types/connection';

export interface DragDropResult {
  draggedId: string;
  targetId: string | null;
  position: 'before' | 'after' | 'inside';
}

export class DragDropManager {
  private draggedConnection: Connection | null = null;
  private dragOverElement: HTMLElement | null = null;

  startDrag(connection: Connection, element: HTMLElement): void {
    this.draggedConnection = connection;
    element.style.opacity = '0.5';
    element.setAttribute('draggable', 'true');
  }

  handleDragOver(event: DragEvent, targetConnection: Connection): void {
    event.preventDefault();
    
    if (!this.draggedConnection || this.draggedConnection.id === targetConnection.id) {
      return;
    }

    const element = event.currentTarget as HTMLElement;
    const rect = element.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const height = rect.height;

    // Clear previous indicators
    this.clearDropIndicators();

    // Determine drop position
    if (targetConnection.isGroup) {
      // Can drop inside groups
      if (y < height * 0.25) {
        this.showDropIndicator(element, 'before');
      } else if (y > height * 0.75) {
        this.showDropIndicator(element, 'after');
      } else {
        this.showDropIndicator(element, 'inside');
      }
    } else {
      // Can only drop before/after regular connections
      if (y < height * 0.5) {
        this.showDropIndicator(element, 'before');
      } else {
        this.showDropIndicator(element, 'after');
      }
    }

    this.dragOverElement = element;
  }

  handleDrop(event: DragEvent, targetConnection: Connection): DragDropResult | null {
    event.preventDefault();
    
    if (!this.draggedConnection || this.draggedConnection.id === targetConnection.id) {
      return null;
    }

    const element = event.currentTarget as HTMLElement;
    const rect = element.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const height = rect.height;

    let position: 'before' | 'after' | 'inside';

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

    const result: DragDropResult = {
      draggedId: this.draggedConnection.id,
      targetId: targetConnection.id,
      position,
    };

    this.endDrag();
    return result;
  }

  endDrag(): void {
    this.clearDropIndicators();
    
    if (this.draggedConnection) {
      // Reset dragged element opacity
      const draggedElement = document.querySelector(`[data-connection-id="${this.draggedConnection.id}"]`) as HTMLElement;
      if (draggedElement) {
        draggedElement.style.opacity = '1';
        draggedElement.removeAttribute('draggable');
      }
    }

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

  // Process the drop result and update connections
  processDropResult(
    result: DragDropResult,
    connections: Connection[]
  ): Connection[] {
    const draggedConnection = connections.find(c => c.id === result.draggedId);
    const targetConnection = connections.find(c => c.id === result.targetId);
    
    if (!draggedConnection || !targetConnection) {
      return connections;
    }

    // Remove dragged connection from its current position
    const updatedConnections = connections.filter(c => c.id !== result.draggedId);
    
    // Update parent relationships
    let newParentId: string | undefined;
    
    if (result.position === 'inside' && targetConnection.isGroup) {
      newParentId = targetConnection.id;
    } else {
      newParentId = targetConnection.parentId;
    }

    // Update the dragged connection's parent
    const updatedDraggedConnection: Connection = {
      ...draggedConnection,
      parentId: newParentId,
      updatedAt: new Date(),
    };

    // Find insertion index
    let insertIndex = 0;
    
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

    // Insert the connection at the new position
    updatedConnections.splice(insertIndex, 0, updatedDraggedConnection);
    
    return updatedConnections;
  }
}
