type MockPageProps = {
  title: string;
  description: string;
};

export function MockPage({ title, description }: MockPageProps) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground">{description}</p>
      <div className="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Mock page — content coming soon
      </div>
    </div>
  );
}
