"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { AutolinkText } from "@/components/autolink-text";
import { MessageAttachment, type Attachment } from "@/features/attachments";
import { editMessage } from "@/features/chat-history";
import { cn } from "@/lib/utils";
import { CheckIcon, PencilIcon, XIcon } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { ExpandableClamp } from "./expandable-clamp";

type Props = {
  chatId?: string;
  messageId?: string;
  content: string;
  attachments?: Attachment[];
};

export function UserMessage({ chatId, messageId, content, attachments }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canEdit = !!chatId && !!messageId;

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(editText.length, editText.length);
    }
  }, [isEditing, editText.length]);

  const handleSave = () => {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === content) {
      setEditText(content);
      setIsEditing(false);
      return;
    }
    if (canEdit) editMessage(chatId, messageId, trimmed);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditText(content);
    setIsEditing(false);
  };

  return (
    <Message from="user" className="py-3">
      {attachments && attachments.length > 0 && (
        <div className="flex max-w-[min(85%,100%)] flex-col items-end gap-2 self-end">
          {attachments.map((attachment) => (
            <MessageAttachment key={attachment.id} attachment={attachment} />
          ))}
        </div>
      )}
      <MessageContent
        className={cn(
          "relative max-w-[min(85%,100%)] rounded-2xl dark:text-white rounded-tr-sm bg-primary/20! text-primary-foreground! px-5 py-3",
          "wrap-break-word group",
        )}
      >
        {canEdit && !isEditing && (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-background/80 text-foreground opacity-0 transition-opacity hover:bg-background group-hover:opacity-100 focus-visible:opacity-100"
            title="Edit message"
            aria-label="Edit message"
          >
            <PencilIcon className="size-3" />
          </button>
        )}

        {isEditing ? (
          <div className="flex flex-col gap-2">
            <Textarea
              ref={textareaRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSave();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  handleCancel();
                }
              }}
              className="min-h-[3rem] resize-none border-0 bg-background/90 p-2 text-sm text-foreground shadow-none focus-visible:ring-1 focus-visible:ring-ring"
              rows={2}
            />
            <div className="flex items-center justify-end gap-1">
              <Button type="button" size="xs" variant="ghost" onClick={handleCancel}>
                <XIcon className="mr-1 size-3" />
                Cancel
              </Button>
              <Button type="button" size="xs" onClick={handleSave}>
                <CheckIcon className="mr-1 size-3" />
                Save
              </Button>
            </div>
          </div>
        ) : (
          <ExpandableClamp
            maxHeightClass="max-h-48"
            className="[&_button]:text-foreground/80 [&_button:hover]:text-foreground dark:text-white"
          >
            <p className="whitespace-pre-wrap">
              <AutolinkText text={content} linkClassName="text-foreground/90" />
            </p>
          </ExpandableClamp>
        )}
      </MessageContent>
    </Message>
  );
}
