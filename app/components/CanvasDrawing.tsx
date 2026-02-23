import { useRef, useEffect, useState, useCallback } from "react";
import { Form } from "react-router";
import { cn } from "~/utils/cn";

interface CanvasDrawingProps {
  playerId: number;
  userId: number | null;
  existingDrawingUrl?: string | null;
  availableImages?: {
    players: { name: string; url: string }[];
    miis: { name: string; url: string }[];
    teamLogos: { name: string; url: string }[];
  };
}

interface PastedImage {
  id: string;
  img: HTMLImageElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TextElement {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily: "sans-serif" | "serif" | "cursive";
  color: string;
}

type DragType =
  | "move"
  | "resize-nw"
  | "resize-ne"
  | "resize-sw"
  | "resize-se"
  | null;

interface DragState {
  type: DragType;
  imageId: string;
  startX: number;
  startY: number;
  startImageX: number;
  startImageY: number;
  startImageWidth: number;
  startImageHeight: number;
}

export function CanvasDrawing({
  playerId,
  userId,
  existingDrawingUrl,
  availableImages,
}: CanvasDrawingProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const imageDataInputRef = useRef<HTMLInputElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastX, setLastX] = useState(0);
  const [lastY, setLastY] = useState(0);
  const [hasChanges, setHasChanges] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [pastedImages, setPastedImages] = useState<PastedImage[]>([]);
  const [textElements, setTextElements] = useState<TextElement[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [isEditingText, setIsEditingText] = useState<string | null>(null);
  const [tool, setTool] = useState<"brush" | "spray" | "text">("brush");
  const [color, setColor] = useState("#000000");
  const [brushSize, setBrushSize] = useState(2);
  const [fontFamily, setFontFamily] = useState<
    "sans-serif" | "serif" | "cursive"
  >("sans-serif");
  const [textInput, setTextInput] = useState("");
  const [showImageBrowser, setShowImageBrowser] = useState(false);
  const [imageSearchQuery, setImageSearchQuery] = useState("");
  const [selectedImageCategory, setSelectedImageCategory] = useState<
    "players" | "miis" | "teamLogos"
  >("players");
  const sprayIntervalRef = useRef<number | null>(null);
  const sprayPositionRef = useRef<{ x: number; y: number } | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  const brightColors = [
    "#FF0000", // Red
    "#FF6B00", // Orange
    "#FFD700", // Gold
    "#FFFF00", // Yellow
    "#00FF00", // Lime
    "#00FF7F", // Spring Green
    "#00FFFF", // Cyan
    "#0080FF", // Blue
    "#8000FF", // Purple
    "#FF00FF", // Magenta
    "#FF1493", // Deep Pink
    "#FF69B4", // Hot Pink
  ];

  // Initialize canvas with existing drawing or blank canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    canvas.width = 800;
    canvas.height = 600;

    // Fill with white background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Load existing drawing if available
    if (existingDrawingUrl && !imageLoaded) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setImageLoaded(true);
      };
      img.onerror = () => {
        setImageLoaded(true);
      };
      img.src = existingDrawingUrl;
    } else {
      setImageLoaded(true);
    }
  }, [existingDrawingUrl, imageLoaded]);

  const commitPastedImagesToCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Draw all pasted images to canvas
    pastedImages.forEach((pastedImage) => {
      ctx.drawImage(
        pastedImage.img,
        pastedImage.x,
        pastedImage.y,
        pastedImage.width,
        pastedImage.height,
      );
    });

    // Clear pasted images
    setPastedImages([]);
    setSelectedImageId(null);
    setHasChanges(true);
  }, [pastedImages]);

  const commitTextElementsToCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Draw all text elements to canvas
    textElements.forEach((textEl) => {
      ctx.save();
      ctx.font = `${textEl.fontSize}px ${textEl.fontFamily}`;
      ctx.fillStyle = textEl.color;
      ctx.textBaseline = "top";
      ctx.fillText(textEl.text, textEl.x, textEl.y);
      ctx.restore();
    });

    // Clear text elements
    setTextElements([]);
    setSelectedTextId(null);
    setIsEditingText(null);
    setHasChanges(true);
  }, [textElements]);

  const drawSpray = useCallback(
    (x: number, y: number, ctx: CanvasRenderingContext2D) => {
      const density = Math.max(1, Math.floor(brushSize / 2));
      const radius = brushSize * 2;

      for (let i = 0; i < density; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * radius;
        const sprayX = x + Math.cos(angle) * distance;
        const sprayY = y + Math.sin(angle) * distance;

        ctx.fillStyle = color;
        ctx.fillRect(sprayX, sprayY, 1, 1);
      }
    },
    [color, brushSize],
  );

  const addImageFromUrl = useCallback((imageUrl: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const imageId = `img-${Date.now()}-${Math.random()}`;
      const maxWidth = Math.min(img.width, canvas.width * 0.8);
      const maxHeight = Math.min(img.height, canvas.height * 0.8);
      const scale = Math.min(maxWidth / img.width, maxHeight / img.height);
      const width = img.width * scale;
      const height = img.height * scale;
      const x = (canvas.width - width) / 2;
      const y = (canvas.height - height) / 2;

      setPastedImages((prev) => [
        ...prev,
        {
          id: imageId,
          img,
          x,
          y,
          width,
          height,
        },
      ]);
      setSelectedImageId(imageId);
      setHasChanges(true);
      setShowImageBrowser(false);
    };
    img.src = imageUrl;
  }, []);

  const addTextToCanvas = useCallback(
    (x: number, y: number) => {
      if (!textInput.trim()) return;

      const textId = `text-${Date.now()}-${Math.random()}`;
      const fontSize = brushSize * 10;

      setTextElements((prev) => [
        ...prev,
        {
          id: textId,
          text: textInput,
          x,
          y,
          fontSize,
          fontFamily,
          color,
        },
      ]);
      setSelectedTextId(textId);
      setIsEditingText(textId);
      setTextInput("");
      setHasChanges(true);
    },
    [textInput, color, brushSize, fontFamily],
  );

  const startDrawing = useCallback(
    (
      e:
        | React.MouseEvent<HTMLCanvasElement>
        | React.TouchEvent<HTMLCanvasElement>,
    ) => {
      if (!userId) return;

      // Don't start drawing if we're interacting with pasted images or text
      if (dragState || selectedImageId || selectedTextId) {
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      let x: number;
      let y: number;

      if ("touches" in e) {
        // Touch event
        e.preventDefault();
        x = e.touches[0].clientX - rect.left;
        y = e.touches[0].clientY - rect.top;
      } else {
        // Mouse event
        x = e.clientX - rect.left;
        y = e.clientY - rect.top;
      }

      // Handle text tool
      if (tool === "text") {
        // Don't handle text tool clicks here - let the text overlay handle it
        // Only add new text if clicking on empty canvas and input has content
        const clickedText = textElements.find(
          (textEl) =>
            x >= textEl.x &&
            x <= textEl.x + 200 && // Approximate width
            y >= textEl.y &&
            y <= textEl.y + textEl.fontSize * 1.5, // Approximate height
        );
        if (!clickedText && textInput.trim()) {
          addTextToCanvas(x, y);
        }
        return;
      }

      setIsDrawing(true);
      setHasChanges(true);

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      setLastX(x);
      setLastY(y);

      // Start spray interval if using spray tool
      if (tool === "spray") {
        sprayPositionRef.current = { x, y };
        const sprayInterval = window.setInterval(() => {
          if (canvas && ctx && sprayPositionRef.current) {
            drawSpray(
              sprayPositionRef.current.x,
              sprayPositionRef.current.y,
              ctx,
            );
          }
        }, 16); // ~60fps
        sprayIntervalRef.current = sprayInterval;
      }
    },
    [userId, dragState, selectedImageId, tool, drawSpray, addTextToCanvas],
  );

  const draw = useCallback(
    (
      e:
        | React.MouseEvent<HTMLCanvasElement>
        | React.TouchEvent<HTMLCanvasElement>,
    ) => {
      if (!isDrawing || !userId) return;

      // If there are pasted images or text elements and we start drawing, commit them first
      if (pastedImages.length > 0) {
        commitPastedImagesToCanvas();
      }
      if (textElements.length > 0) {
        commitTextElementsToCanvas();
      }

      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const rect = canvas.getBoundingClientRect();
      let x: number;
      let y: number;

      if ("touches" in e) {
        // Touch event
        e.preventDefault();
        x = e.touches[0].clientX - rect.left;
        y = e.touches[0].clientY - rect.top;
      } else {
        // Mouse event
        x = e.clientX - rect.left;
        y = e.clientY - rect.top;
      }

      if (tool === "brush") {
        ctx.strokeStyle = color;
        ctx.lineWidth = brushSize;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.stroke();
      } else if (tool === "spray") {
        // Update spray position for the interval
        sprayPositionRef.current = { x, y };
        // Also draw immediately
        drawSpray(x, y, ctx);
      }

      setLastX(x);
      setLastY(y);
    },
    [
      isDrawing,
      lastX,
      lastY,
      userId,
      pastedImages,
      commitPastedImagesToCanvas,
      tool,
      color,
      brushSize,
      drawSpray,
    ],
  );

  const stopDrawing = useCallback(() => {
    setIsDrawing(false);
    // Clear spray interval
    if (sprayIntervalRef.current !== null) {
      clearInterval(sprayIntervalRef.current);
      sprayIntervalRef.current = null;
    }
    sprayPositionRef.current = null;
  }, []);

  // Handle paste event
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      if (!userId) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf("image") !== -1) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;

          const img = new Image();
          img.onload = () => {
            // Create a new pasted image object
            const imageId = `img-${Date.now()}-${Math.random()}`;
            const maxWidth = Math.min(img.width, canvas.width * 0.8);
            const maxHeight = Math.min(img.height, canvas.height * 0.8);
            const scale = Math.min(
              maxWidth / img.width,
              maxHeight / img.height,
            );
            const width = img.width * scale;
            const height = img.height * scale;
            const x = (canvas.width - width) / 2;
            const y = (canvas.height - height) / 2;

            setPastedImages((prev) => [
              ...prev,
              {
                id: imageId,
                img,
                x,
                y,
                width,
                height,
              },
            ]);
            setSelectedImageId(imageId);
            setHasChanges(true);
          };
          img.src = URL.createObjectURL(blob);
          break;
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("paste", handlePaste);
    };
  }, [userId]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setPastedImages([]);
    setTextElements([]);
    setSelectedImageId(null);
    setSelectedTextId(null);
    setIsEditingText(null);
    setHasChanges(true);
  }, []);

  const handleOverlayMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, imageId: string, type: DragType) => {
      if (!userId) return;
      e.preventDefault();
      e.stopPropagation();

      const image = pastedImages.find((img) => img.id === imageId);
      if (!image) return;

      const overlay = overlayRef.current;
      if (!overlay) return;

      const rect = overlay.getBoundingClientRect();
      const startX = e.clientX - rect.left;
      const startY = e.clientY - rect.top;

      setDragState({
        type,
        imageId,
        startX,
        startY,
        startImageX: image.x,
        startImageY: image.y,
        startImageWidth: image.width,
        startImageHeight: image.height,
      });
      setSelectedImageId(imageId);
      setSelectedTextId(null);
      setIsEditingText(null);
    },
    [userId, pastedImages],
  );

  const handleTextMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, textId: string, type: DragType) => {
      if (!userId) return;
      e.preventDefault();
      e.stopPropagation();

      const textEl = textElements.find((t) => t.id === textId);
      if (!textEl) return;

      const overlay = overlayRef.current;
      if (!overlay) return;

      const rect = overlay.getBoundingClientRect();
      const startX = e.clientX - rect.left;
      const startY = e.clientY - rect.top;

      setDragState({
        type,
        imageId: textId, // Reusing imageId field for textId
        startX,
        startY,
        startImageX: textEl.x,
        startImageY: textEl.y,
        startImageWidth: textEl.fontSize * 5, // Approximate width for resize
        startImageHeight: textEl.fontSize * 1.5, // Approximate height for resize
      });
      setSelectedTextId(textId);
      setSelectedImageId(null);
      setIsEditingText(null);
    },
    [userId, textElements],
  );

  // Global mouse move handler for dragging
  useEffect(() => {
    if (!dragState) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      const overlay = overlayRef.current;
      if (!overlay || !dragState) return;

      const rect = overlay.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const currentY = e.clientY - rect.top;

      const deltaX = currentX - dragState.startX;
      const deltaY = currentY - dragState.startY;

      // Handle text element dragging/resizing
      if (textElements.find((t) => t.id === dragState.imageId)) {
        setTextElements((prev) =>
          prev.map((textEl) => {
            if (textEl.id !== dragState.imageId) return textEl;

            if (dragState.type === "move") {
              return {
                ...textEl,
                x: dragState.startImageX + deltaX,
                y: dragState.startImageY + deltaY,
              };
            } else if (dragState.type?.startsWith("resize-")) {
              const minSize = 10;
              let newFontSize = textEl.fontSize;
              let newX = textEl.x;
              let newY = textEl.y;

              // Calculate font size change based on resize direction
              if (
                dragState.type === "resize-se" ||
                dragState.type === "resize-ne"
              ) {
                newFontSize = Math.max(minSize, textEl.fontSize + deltaX / 5);
              } else {
                newFontSize = Math.max(minSize, textEl.fontSize - deltaX / 5);
                newX =
                  dragState.startImageX +
                  (dragState.startImageWidth - newFontSize * 5);
              }

              if (
                dragState.type === "resize-ne" ||
                dragState.type === "resize-nw"
              ) {
                newY =
                  dragState.startImageY +
                  (dragState.startImageHeight - newFontSize * 1.5);
              }

              return {
                ...textEl,
                fontSize: newFontSize,
                x: newX,
                y: newY,
              };
            }

            return textEl;
          }),
        );
        setHasChanges(true);
        return;
      }

      setPastedImages((prev) =>
        prev.map((img) => {
          if (img.id !== dragState.imageId) return img;

          if (dragState.type === "move") {
            return {
              ...img,
              x: dragState.startImageX + deltaX,
              y: dragState.startImageY + deltaY,
            };
          } else if (dragState.type?.startsWith("resize-")) {
            const minSize = 20;
            let newWidth = dragState.startImageWidth;
            let newHeight = dragState.startImageHeight;
            let newX = dragState.startImageX;
            let newY = dragState.startImageY;

            if (dragState.type === "resize-se") {
              // Allow scaling up beyond original size
              newWidth = Math.max(minSize, dragState.startImageWidth + deltaX);
              newHeight = Math.max(
                minSize,
                dragState.startImageHeight + deltaY,
              );
            } else if (dragState.type === "resize-sw") {
              // Allow scaling up beyond original size
              newWidth = Math.max(minSize, dragState.startImageWidth - deltaX);
              newHeight = Math.max(
                minSize,
                dragState.startImageHeight + deltaY,
              );
              newX =
                dragState.startImageX + (dragState.startImageWidth - newWidth);
            } else if (dragState.type === "resize-ne") {
              // Allow scaling up beyond original size
              newWidth = Math.max(minSize, dragState.startImageWidth + deltaX);
              newHeight = Math.max(
                minSize,
                dragState.startImageHeight - deltaY,
              );
              newY =
                dragState.startImageY +
                (dragState.startImageHeight - newHeight);
            } else if (dragState.type === "resize-nw") {
              // Allow scaling up beyond original size
              newWidth = Math.max(minSize, dragState.startImageWidth - deltaX);
              newHeight = Math.max(
                minSize,
                dragState.startImageHeight - deltaY,
              );
              newX =
                dragState.startImageX + (dragState.startImageWidth - newWidth);
              newY =
                dragState.startImageY +
                (dragState.startImageHeight - newHeight);
            }

            return {
              ...img,
              x: newX,
              y: newY,
              width: newWidth,
              height: newHeight,
            };
          }

          return img;
        }),
      );
      setHasChanges(true);
    };

    const handleGlobalMouseUp = () => {
      setDragState(null);
    };

    document.addEventListener("mousemove", handleGlobalMouseMove);
    document.addEventListener("mouseup", handleGlobalMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleGlobalMouseMove);
      document.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [dragState]);

  const deleteSelectedImage = useCallback(() => {
    if (!selectedImageId) return;
    setPastedImages((prev) => prev.filter((img) => img.id !== selectedImageId));
    setSelectedImageId(null);
    setHasChanges(true);
  }, [selectedImageId]);

  const handleFormSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      const canvas = canvasRef.current;
      const imageDataInput = imageDataInputRef.current;
      if (!canvas || !imageDataInput) {
        e.preventDefault();
        return;
      }

      // Commit any pasted images to canvas before saving
      if (pastedImages.length > 0) {
        commitPastedImagesToCanvas();
      }

      // Commit any pasted images or text to canvas before saving
      if (pastedImages.length > 0) {
        commitPastedImagesToCanvas();
      }
      if (textElements.length > 0) {
        commitTextElementsToCanvas();
      }

      // Update the hidden input with current canvas data before submission
      const dataUrl = canvas.toDataURL("image/png");
      imageDataInput.value = dataUrl;
    },
    [
      pastedImages,
      textElements,
      commitPastedImagesToCanvas,
      commitTextElementsToCanvas,
    ],
  );

  if (!userId) {
    return (
      <div className="text-center text-gray-400 p-4">
        Please log in to draw on this player
      </div>
    );
  }

  const canvasWidth = 800;
  const canvasHeight = 600;
  const handleSize = 8;

  return (
    <div className="flex flex-col gap-4 items-center">
      <div className="relative border-2 border-cell-gray/50 bg-white rounded-lg p-4">
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className={cn(
            "border border-gray-300 rounded relative z-0",
            tool === "text"
              ? "cursor-text"
              : pastedImages.length === 0
                ? "cursor-crosshair"
                : "cursor-default",
          )}
          style={{ touchAction: "none" }}
          width={canvasWidth}
          height={canvasHeight}
        />
        {/* Overlay for pasted images with drag handles */}
        {pastedImages.length > 0 && (
          <div
            ref={overlayRef}
            className="absolute inset-4 pointer-events-none z-10"
            style={{ width: canvasWidth, height: canvasHeight }}
            onClick={(e) => {
              // Deselect if clicking on empty space
              if (e.target === e.currentTarget) {
                setSelectedImageId(null);
              }
            }}
          >
            {pastedImages.map((pastedImage) => {
              const isSelected = selectedImageId === pastedImage.id;
              return (
                <div
                  key={pastedImage.id}
                  className="absolute pointer-events-auto"
                  style={{
                    left: pastedImage.x,
                    top: pastedImage.y,
                    width: pastedImage.width,
                    height: pastedImage.height,
                    border: isSelected
                      ? "2px dashed #3b82f6"
                      : "2px solid transparent",
                    cursor:
                      dragState?.imageId === pastedImage.id &&
                      dragState.type === "move"
                        ? "grabbing"
                        : "grab",
                  }}
                  onMouseDown={(e) => {
                    // Only handle move if clicking on the image container itself, not handles
                    if (
                      e.target === e.currentTarget ||
                      (e.target as HTMLElement).tagName === "IMG"
                    ) {
                      handleOverlayMouseDown(e, pastedImage.id, "move");
                    }
                  }}
                >
                  <img
                    src={pastedImage.img.src}
                    alt="Pasted"
                    className="w-full h-full pointer-events-none select-none"
                    draggable={false}
                  />
                  {isSelected && (
                    <>
                      {/* Corner resize handles */}
                      {/* NW */}
                      <div
                        className="absolute bg-blue-500 border-2 border-white rounded-full cursor-nwse-resize"
                        style={{
                          left: -handleSize / 2,
                          top: -handleSize / 2,
                          width: handleSize,
                          height: handleSize,
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleOverlayMouseDown(
                            e,
                            pastedImage.id,
                            "resize-nw",
                          );
                        }}
                      />
                      {/* NE */}
                      <div
                        className="absolute bg-blue-500 border-2 border-white rounded-full cursor-nesw-resize"
                        style={{
                          right: -handleSize / 2,
                          top: -handleSize / 2,
                          width: handleSize,
                          height: handleSize,
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleOverlayMouseDown(
                            e,
                            pastedImage.id,
                            "resize-ne",
                          );
                        }}
                      />
                      {/* SW */}
                      <div
                        className="absolute bg-blue-500 border-2 border-white rounded-full cursor-nesw-resize"
                        style={{
                          left: -handleSize / 2,
                          bottom: -handleSize / 2,
                          width: handleSize,
                          height: handleSize,
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleOverlayMouseDown(
                            e,
                            pastedImage.id,
                            "resize-sw",
                          );
                        }}
                      />
                      {/* SE */}
                      <div
                        className="absolute bg-blue-500 border-2 border-white rounded-full cursor-nwse-resize"
                        style={{
                          right: -handleSize / 2,
                          bottom: -handleSize / 2,
                          width: handleSize,
                          height: handleSize,
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleOverlayMouseDown(
                            e,
                            pastedImage.id,
                            "resize-se",
                          );
                        }}
                      />
                      {/* Delete button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSelectedImage();
                        }}
                        className="absolute -top-8 left-0 bg-red-500 hover:bg-red-600 text-white text-xs px-2 py-1 rounded"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {/* Text elements overlay */}
        {textElements.length > 0 && (
          <div
            className="absolute inset-4 pointer-events-none z-10"
            style={{ width: canvasWidth, height: canvasHeight }}
            onClick={(e) => {
              // Deselect if clicking on empty space
              if (e.target === e.currentTarget) {
                setSelectedTextId(null);
                setIsEditingText(null);
              }
            }}
          >
            {textElements.map((textEl) => {
              const isSelected = selectedTextId === textEl.id;
              const isEditing = isEditingText === textEl.id;
              return (
                <div
                  key={textEl.id}
                  className="absolute pointer-events-auto"
                  style={{
                    left: textEl.x,
                    top: textEl.y,
                    border: isSelected
                      ? "2px dashed #3b82f6"
                      : "2px solid transparent",
                    cursor:
                      dragState?.imageId === textEl.id &&
                      dragState.type === "move"
                        ? "grabbing"
                        : "grab",
                    padding: "2px",
                    minWidth: "20px",
                    minHeight: "20px",
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!isEditing) {
                      // Always start drag when clicking on text container
                      handleTextMouseDown(e, textEl.id, "move");
                    }
                  }}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsEditingText(textEl.id);
                    setTextInput(textEl.text);
                  }}
                >
                  {isEditing ? (
                    <input
                      type="text"
                      value={textInput}
                      onChange={(e) => {
                        setTextInput(e.target.value);
                        setTextElements((prev) =>
                          prev.map((t) =>
                            t.id === textEl.id
                              ? { ...t, text: e.target.value }
                              : t,
                          ),
                        );
                      }}
                      onBlur={() => setIsEditingText(null)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setIsEditingText(null);
                        }
                        e.stopPropagation();
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                      }}
                      className="px-1 py-0 border border-blue-500 bg-white text-sm"
                      style={{
                        fontFamily: textEl.fontFamily,
                        fontSize: `${textEl.fontSize}px`,
                        color: textEl.color,
                        minWidth: "100px",
                      }}
                      autoFocus
                    />
                  ) : (
                    <div
                      style={{
                        fontFamily: textEl.fontFamily,
                        fontSize: `${textEl.fontSize}px`,
                        color: textEl.color,
                        whiteSpace: "nowrap",
                        userSelect: "none",
                        pointerEvents: "none", // Let parent handle mouse events
                      }}
                    >
                      {textEl.text}
                    </div>
                  )}
                  {isSelected && !isEditing && (
                    <>
                      {/* Resize handle (bottom-right) */}
                      <div
                        className="absolute bg-blue-500 border-2 border-white rounded-full cursor-nwse-resize pointer-events-auto"
                        style={{
                          right: -handleSize / 2,
                          bottom: -handleSize / 2,
                          width: handleSize,
                          height: handleSize,
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleTextMouseDown(e, textEl.id, "resize-se");
                        }}
                      />
                      {/* Delete button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTextElements((prev) =>
                            prev.filter((t) => t.id !== textEl.id),
                          );
                          setSelectedTextId(null);
                          setIsEditingText(null);
                          setHasChanges(true);
                        }}
                        className="absolute -top-8 left-0 bg-red-500 hover:bg-red-600 text-white text-xs px-2 py-1 rounded"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Drawing Tools */}
      <div className="flex flex-col gap-4 w-full max-w-2xl">
        <div className="border-2 border-cell-gray/50 bg-cell-gray/40 rounded-lg p-4">
          <div className="flex flex-wrap gap-4 items-center justify-center">
            {/* Tool Selection */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTool("brush")}
                className={cn(
                  "px-4 py-2 rounded text-sm font-medium transition-colors",
                  tool === "brush"
                    ? "bg-blue-500 text-white"
                    : "bg-gray-200 hover:bg-gray-300",
                )}
                title="Brush Tool"
              >
                Brush
              </button>
              <button
                type="button"
                onClick={() => setTool("spray")}
                className={cn(
                  "px-4 py-2 rounded text-sm font-medium transition-colors",
                  tool === "spray"
                    ? "bg-blue-500 text-white"
                    : "bg-gray-200 hover:bg-gray-300",
                )}
                title="Spray Tool"
              >
                Spray
              </button>
              <button
                type="button"
                onClick={() => setTool("text")}
                className={cn(
                  "px-4 py-2 rounded text-sm font-medium transition-colors",
                  tool === "text"
                    ? "bg-blue-500 text-white"
                    : "bg-gray-200 hover:bg-gray-300",
                )}
                title="Text Tool"
              >
                Text
              </button>
            </div>

            {/* Color Picker */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <label htmlFor="color-picker" className="text-sm font-medium">
                  Color:
                </label>
                <input
                  type="color"
                  id="color-picker"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-12 h-8 rounded border-2 border-gray-300 cursor-pointer"
                  style={{ backgroundColor: color }}
                />
                <input
                  type="text"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-20 px-2 py-1 rounded border border-gray-300 text-sm font-mono"
                  placeholder="#000000"
                />
              </div>
              {/* Color Palette */}
              <div className="flex flex-wrap gap-1">
                {brightColors.map((paletteColor) => (
                  <button
                    key={paletteColor}
                    type="button"
                    onClick={() => setColor(paletteColor)}
                    className={cn(
                      "w-6 h-6 rounded border-2 transition-all",
                      color === paletteColor
                        ? "border-gray-800 scale-110"
                        : "border-gray-300 hover:border-gray-500",
                    )}
                    style={{ backgroundColor: paletteColor }}
                    title={paletteColor}
                  />
                ))}
              </div>
            </div>

            {/* Brush Size */}
            <div className="flex items-center gap-2">
              <label htmlFor="brush-size" className="text-sm font-medium">
                Size:
              </label>
              <input
                type="range"
                id="brush-size"
                min="1"
                max="50"
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                className="w-24"
              />
              <span className="text-sm font-mono w-8">{brushSize}</span>
              {/* Brush size preview */}
              <div className="flex items-center gap-1">
                <div
                  className="rounded-full bg-gray-800"
                  style={{
                    width: Math.max(2, brushSize),
                    height: Math.max(2, brushSize),
                  }}
                />
              </div>
            </div>

            {/* Text Tool Options */}
            {tool === "text" && (
              <div className="flex items-center gap-2">
                <label htmlFor="text-input" className="text-sm font-medium">
                  Text:
                </label>
                <input
                  ref={textInputRef}
                  type="text"
                  id="text-input"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Enter text..."
                  className="px-2 py-1 rounded border border-gray-300 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const canvas = canvasRef.current;
                      if (!canvas) return;
                      const rect = canvas.getBoundingClientRect();
                      addTextToCanvas(canvas.width / 2, canvas.height / 2);
                    }
                  }}
                />
                <label htmlFor="font-family" className="text-sm font-medium">
                  Font:
                </label>
                <select
                  id="font-family"
                  value={fontFamily}
                  onChange={(e) =>
                    setFontFamily(
                      e.target.value as "sans-serif" | "serif" | "cursive",
                    )
                  }
                  className="px-2 py-1 rounded border border-gray-300 text-sm"
                >
                  <option value="sans-serif">Sans-serif</option>
                  <option value="serif">Serif</option>
                  <option value="cursive">Cursive</option>
                </select>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Image Browser */}
      {availableImages && (
        <div className="w-full max-w-2xl">
          <div className="border-2 border-cell-gray/50 bg-cell-gray/40 rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Image Browser</h3>
              <button
                type="button"
                onClick={() => setShowImageBrowser(!showImageBrowser)}
                className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm"
              >
                {showImageBrowser ? "Hide" : "Show"} Images
              </button>
            </div>
            {showImageBrowser && (
              <div className="space-y-4">
                {/* Category Selection */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedImageCategory("players")}
                    className={cn(
                      "px-3 py-1 rounded text-sm",
                      selectedImageCategory === "players"
                        ? "bg-blue-500 text-white"
                        : "bg-gray-200 hover:bg-gray-300",
                    )}
                  >
                    Players
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedImageCategory("miis")}
                    className={cn(
                      "px-3 py-1 rounded text-sm",
                      selectedImageCategory === "miis"
                        ? "bg-blue-500 text-white"
                        : "bg-gray-200 hover:bg-gray-300",
                    )}
                  >
                    Miis
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedImageCategory("teamLogos")}
                    className={cn(
                      "px-3 py-1 rounded text-sm",
                      selectedImageCategory === "teamLogos"
                        ? "bg-blue-500 text-white"
                        : "bg-gray-200 hover:bg-gray-300",
                    )}
                  >
                    Team Logos
                  </button>
                </div>

                {/* Search */}
                <input
                  type="text"
                  value={imageSearchQuery}
                  onChange={(e) => setImageSearchQuery(e.target.value)}
                  placeholder="Search images..."
                  className="w-full px-3 py-2 rounded border border-gray-300"
                />

                {/* Image Grid */}
                <div className="max-h-64 overflow-y-auto border border-gray-300 rounded p-2 bg-white">
                  <div className="grid grid-cols-4 gap-2">
                    {(availableImages[selectedImageCategory] || [])
                      .filter((img) =>
                        img.name
                          .toLowerCase()
                          .includes(imageSearchQuery.toLowerCase()),
                      )
                      .map((img) => (
                        <button
                          key={img.url}
                          type="button"
                          onClick={() => addImageFromUrl(img.url)}
                          className="aspect-square border-2 border-gray-300 rounded hover:border-blue-500 overflow-hidden bg-gray-100"
                          title={img.name}
                        >
                          <img
                            src={img.url}
                            alt={img.name}
                            className="w-full h-full object-contain"
                          />
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-2 flex-wrap justify-center">
        {pastedImages.length > 0 && (
          <button
            type="button"
            onClick={commitPastedImagesToCanvas}
            className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded text-sm font-medium"
          >
            Place Images
          </button>
        )}
        {textElements.length > 0 && (
          <button
            type="button"
            onClick={commitTextElementsToCanvas}
            className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded text-sm font-medium"
          >
            Place Text
          </button>
        )}
        <button
          type="button"
          onClick={clearCanvas}
          className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded text-sm font-medium"
        >
          Clear
        </button>

        <Form method="post" onSubmit={handleFormSubmit} className="inline">
          <input type="hidden" name="intent" value="save-drawing" />
          <input
            ref={imageDataInputRef}
            type="hidden"
            name="imageData"
            value=""
          />
          <button
            type="submit"
            disabled={!hasChanges}
            className={cn(
              "px-4 py-2 rounded text-sm font-medium",
              hasChanges
                ? "bg-blue-500 hover:bg-blue-600 text-white"
                : "bg-gray-300 text-gray-500 cursor-not-allowed",
            )}
          >
            Save Drawing
          </button>
        </Form>
      </div>

      <p className="text-sm text-gray-500 text-center max-w-md">
        Click and drag to draw. Press Ctrl+V (Cmd+V on Mac) to paste images from
        your clipboard. Drag images to move them, use corner handles to resize.
        Use the brush or spray tool with different colors and sizes to create
        your drawing.
      </p>
    </div>
  );
}
