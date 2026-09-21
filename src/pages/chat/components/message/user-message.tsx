"use client";

import { Message, MessageContent } from "@/components/ai-elements/message";
import { AutolinkText } from "@/components/autolink-text";
import { MessageAttachment, type Attachment } from "@/features/attachments";
import { cn } from "@/lib/utils";
import { ExpandableClamp } from "./expandable-clamp";

type Props = {
  content: string;
  attachments?: Attachment[];
};

export function UserMessage({ content, attachments }: Props) {
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
          "max-w-[min(85%,100%)] rounded-2xl dark:text-white rounded-tr-sm bg-primary/20! text-primary-foreground! px-5 py-3",
          "wrap-break-word",
        )}
      >
        <ExpandableClamp
          maxHeightClass="max-h-48"
          className="[&_button]:text-foreground/80 [&_button:hover]:text-foreground dark:text-white"
        >
          <p className="whitespace-pre-wrap">
            <AutolinkText text={content} linkClassName="text-foreground/90" />
          </p>
        </ExpandableClamp>
      </MessageContent>
    </Message>
  );
}
