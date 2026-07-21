import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  Plus,
  Trash2,
  Save,
  Bold,
  Italic,
  Underline,
  Type,
  Palette,
  Search,
  X,
  Pin,
  PinOff,
  Hash,
  BookOpen,
} from "lucide-react";
import { useTheme } from "../components/theme-provider";
import { useCourses } from "../lib/courses";

export const Route = createFileRoute("/notes")({
  component: Notes,
});

interface NoteFormatting {
  fontFamily: "sans-serif" | "serif" | "monospace" | "cursive";
  fontSize: "14px" | "16px" | "20px" | "24px";
  bold: boolean;
  italic: boolean;
  underline: boolean;
  backgroundColor: string;
}

type FontFamily = NoteFormatting["fontFamily"];
type FontSize = NoteFormatting["fontSize"];

interface Note {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
  formatting: NoteFormatting;
  tags: string[];
  pinned: boolean;
  course?: string;
}

function Notes() {
  const { theme } = useTheme();
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [formatting, setFormatting] = useState<NoteFormatting>({
    fontFamily: "sans-serif",
    fontSize: "16px",
    bold: false,
    italic: false,
    underline: false,
    backgroundColor: "transparent",
  });
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<string>("");

  const { data: manualCourses = [] } = useCourses();

  const tagColors = [
    "#FEF3C7",
    "#DBEAFE",
    "#D1FAE5",
    "#FCE7F3",
    "#E9D5FF",
    "#FED7AA",
    "#FECACA",
    "#D1D5DB",
  ];

  const getTagColor = (tag: string) => {
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
      hash = tag.charCodeAt(i) + ((hash << 5) - hash);
    }
    return tagColors[Math.abs(hash) % tagColors.length];
  };

  const backgroundColors = [
    { name: "default", value: "transparent" },
    { name: "yellow", value: "#FEF9C3" },
    { name: "blue", value: "#DBEAFE" },
    { name: "green", value: "#D1FAE5" },
    { name: "pink", value: "#FCE7F3" },
    { name: "purple", value: "#E9D5FF" },
    { name: "orange", value: "#FED7AA" },
    { name: "dark", value: "#1F2937" },
  ];

  useEffect(() => {
    const saved = localStorage.getItem("unimateNotes");
    if (saved) {
      const parsedNotes = JSON.parse(saved);
      setNotes(parsedNotes);
      if (parsedNotes.length > 0) {
        setSelectedNoteId(parsedNotes[0].id);
        setTitle(parsedNotes[0].title);
        setBody(parsedNotes[0].body);
        setFormatting(parsedNotes[0].formatting);
        setTags(parsedNotes[0].tags || []);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("unimateNotes", JSON.stringify(notes));
  }, [notes]);

  const handleCreateNote = () => {
    const newNote: Note = {
      id: Date.now().toString(),
      title: "Untitled Note",
      body: "",
      updatedAt: new Date().toISOString(),
      formatting: {
        fontFamily: "sans-serif",
        fontSize: "16px",
        bold: false,
        italic: false,
        underline: false,
        backgroundColor: "transparent",
      },
      tags: [],
      pinned: false,
      course: selectedCourse || undefined,
    };
    setNotes([newNote, ...notes]);
    setSelectedNoteId(newNote.id);
    setTitle(newNote.title);
    setBody(newNote.body);
    setFormatting(newNote.formatting);
    setTags([]);
    setSelectedCourse("");
  };

  const handleDeleteNote = (id: string) => {
    const updatedNotes = notes.filter((note) => note.id !== id);
    setNotes(updatedNotes);
    if (selectedNoteId === id) {
      if (updatedNotes.length > 0) {
        setSelectedNoteId(updatedNotes[0].id);
        setTitle(updatedNotes[0].title);
        setBody(updatedNotes[0].body);
        setFormatting(updatedNotes[0].formatting);
        setTags(updatedNotes[0].tags || []);
      } else {
        setSelectedNoteId(null);
        setTitle("");
        setBody("");
        setTags([]);
        setFormatting({
          fontFamily: "sans-serif",
          fontSize: "16px",
          bold: false,
          italic: false,
          underline: false,
          backgroundColor: "transparent",
        });
      }
    }
  };

  const handleSaveNote = () => {
    if (!selectedNoteId) return;
    const updatedNotes = notes.map((note) =>
      note.id === selectedNoteId
        ? {
            ...note,
            title,
            body,
            formatting,
            tags,
            pinned: note.pinned,
            course: selectedCourse || note.course,
            updatedAt: new Date().toISOString(),
          }
        : note,
    );
    setNotes(updatedNotes);
  };

  const handleSelectNote = (note: Note) => {
    setSelectedNoteId(note.id);
    setTitle(note.title);
    setBody(note.body);
    setFormatting(note.formatting);
    setTags(note.tags || []);
    setSelectedCourse(note.course || "");
  };

  const handleAddTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  };

  const handleTogglePin = (id: string) => {
    const updatedNotes = notes.map((note) =>
      note.id === id ? { ...note, pinned: !note.pinned } : note,
    );
    setNotes(updatedNotes);
  };

  const wordCount = body
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
  const charCount = body.length;

  const filteredNotes = notes
    .filter((note) => {
      const matchesSearch =
        searchQuery === "" ||
        note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        note.body.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesTag = selectedTagFilter === null || note.tags.includes(selectedTagFilter);
      return matchesSearch && matchesTag;
    })
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

  const allTags = Array.from(new Set(notes.flatMap((note) => note.tags || [])));

  const selectedNote = notes.find((note) => note.id === selectedNoteId);

  return (
    <div className="h-screen bg-background">
      <div className="flex h-full">
        {/* Left Panel - Notes List */}
        <div className="w-80 border-r flex flex-col border-border/60">
          <div className="p-4 border-b border-border/60">
            <button
              onClick={handleCreateNote}
              className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              New Note
            </button>
          </div>

          {/* Search Bar */}
          <div className="p-3 border-b border-border/60">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search notes..."
                className="w-full pl-9 pr-8 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary/50 border-border bg-background"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-card/60 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Tag Filter */}
          {allTags.length > 0 && (
            <div className="px-3 py-2 border-b border-border/60 flex flex-wrap gap-1">
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setSelectedTagFilter(selectedTagFilter === tag ? null : tag)}
                  className={`text-xs px-2 py-1 rounded-full transition-colors ${
                    selectedTagFilter === tag
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                  style={{
                    backgroundColor: selectedTagFilter === tag ? undefined : getTagColor(tag),
                  }}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {filteredNotes.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                {notes.length === 0
                  ? "No notes yet. Create your first note!"
                  : "No notes match your search."}
              </div>
            ) : (
              filteredNotes.map((note) => (
                <div
                  key={note.id}
                  onClick={() => handleSelectNote(note)}
                  className={`p-4 border-b border-border/60 cursor-pointer transition-colors ${
                    selectedNoteId === note.id ? "bg-primary/10" : "hover:bg-card/60"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {note.pinned && <Pin className="h-3 w-3 text-primary" />}
                        <h3 className="font-medium text-foreground text-sm truncate">
                          {note.title || "Untitled Note"}
                        </h3>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        {note.body || "No content"}
                      </p>
                      {note.tags && note.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {note.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-xs px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: getTagColor(tag) }}
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        {new Date(note.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTogglePin(note.id);
                        }}
                        className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-card/80 transition-colors"
                      >
                        {note.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteNote(note.id);
                        }}
                        className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-card/80 transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Panel - Editor */}
        <div className="flex-1 flex flex-col">
          {selectedNote ? (
            <>
              <div className="p-4 border-b flex items-center gap-4 border-border/60">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Note title..."
                  className={`flex-1 text-lg font-medium bg-transparent border-none focus:outline-none text-foreground placeholder:text-muted-foreground`}
                />
                <button
                  onClick={handleSaveNote}
                  className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Save className="h-4 w-4" />
                  Save
                </button>
              </div>

              {/* Course Selector */}
              {manualCourses.length > 0 && (
                <div className="px-4 py-2 border-b flex items-center gap-2 border-border/60">
                  <BookOpen className="h-4 w-4 text-muted-foreground" />
                  <select
                    value={selectedCourse}
                    onChange={(e) => setSelectedCourse(e.target.value)}
                    className="flex-1 text-sm bg-transparent border-none focus:outline-none cursor-pointer text-foreground"
                  >
                    <option value="">No course</option>
                    {manualCourses.map((course) => (
                      <option key={course.id} value={course.name}>
                        {course.name} ({course.course_code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Tag Input */}
              <div className="px-4 py-2 border-b flex items-center gap-2 flex-wrap border-border/60">
                <Hash className="h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                  placeholder="Add tag..."
                  className="flex-1 min-w-[120px] text-sm bg-transparent border-none focus:outline-none text-foreground placeholder:text-muted-foreground"
                />
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-2 py-1 rounded-full flex items-center gap-1"
                    style={{ backgroundColor: getTagColor(tag) }}
                  >
                    #{tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="h-4 w-4 rounded-full flex items-center justify-center hover:bg-black/10 transition-colors"
                    >
                      <X className="h-2 w-2" />
                    </button>
                  </span>
                ))}
              </div>

              {/* Formatting Toolbar */}
              <div className="px-4 py-2 border-b flex items-center gap-3 flex-wrap border-border/60">
                {/* Font Family */}
                <div className="flex items-center gap-2">
                  <Type className="h-4 w-4 text-muted-foreground" />
                  <select
                    value={formatting.fontFamily}
                    onChange={(e) =>
                      setFormatting({
                        ...formatting,
                        fontFamily: e.target.value as FontFamily,
                      })
                    }
                    className="text-xs bg-transparent border-none focus:outline-none cursor-pointer text-foreground"
                  >
                    <option value="sans-serif">Sans</option>
                    <option value="serif">Serif</option>
                    <option value="monospace">Mono</option>
                    <option value="cursive">Cursive</option>
                  </select>
                </div>

                {/* Font Size */}
                <div className="flex items-center gap-2">
                  <select
                    value={formatting.fontSize}
                    onChange={(e) =>
                      setFormatting({
                        ...formatting,
                        fontSize: e.target.value as FontSize,
                      })
                    }
                    className="text-xs bg-transparent border-none focus:outline-none cursor-pointer text-foreground"
                  >
                    <option value="14px">Small</option>
                    <option value="16px">Medium</option>
                    <option value="20px">Large</option>
                    <option value="24px">XL</option>
                  </select>
                </div>

                <div className="h-4 w-px bg-border/60" />

                {/* Text Formatting */}
                <button
                  onClick={() => setFormatting({ ...formatting, bold: !formatting.bold })}
                  className={`p-1.5 rounded transition-colors ${
                    formatting.bold
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-card/60"
                  }`}
                >
                  <Bold className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setFormatting({ ...formatting, italic: !formatting.italic })}
                  className={`p-1.5 rounded transition-colors ${
                    formatting.italic
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-card/60"
                  }`}
                >
                  <Italic className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setFormatting({ ...formatting, underline: !formatting.underline })}
                  className={`p-1.5 rounded transition-colors ${
                    formatting.underline
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-card/60"
                  }`}
                >
                  <Underline className="h-4 w-4" />
                </button>

                <div className="h-4 w-px bg-border/60" />

                {/* Background Color */}
                <div className="flex items-center gap-2">
                  <Palette className="h-4 w-4 text-muted-foreground" />
                  <div className="flex gap-1">
                    {backgroundColors.map((color) => (
                      <button
                        key={color.name}
                        onClick={() =>
                          setFormatting({ ...formatting, backgroundColor: color.value })
                        }
                        className={`h-5 w-5 rounded-full border-2 transition-all hover:scale-110 ${
                          formatting.backgroundColor === color.value
                            ? "border-foreground scale-110"
                            : "border-transparent"
                        }`}
                        style={{
                          backgroundColor: color.value === "transparent" ? "#f5f5f5" : color.value,
                        }}
                        title={color.name}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div
                className="flex-1 p-6 flex flex-col"
                style={{ backgroundColor: formatting.backgroundColor }}
              >
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Start writing your note..."
                  className={`flex-1 resize-none bg-transparent border-none focus:outline-none text-foreground placeholder:text-muted-foreground leading-relaxed`}
                  style={{
                    fontFamily: formatting.fontFamily,
                    fontSize: formatting.fontSize,
                    fontWeight: formatting.bold ? "bold" : "normal",
                    fontStyle: formatting.italic ? "italic" : "normal",
                    textDecoration: formatting.underline ? "underline" : "none",
                  }}
                />
                <div className="text-xs text-muted-foreground mt-2">
                  {wordCount} words · {charCount} characters
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <p className="text-muted-foreground mb-4">No note selected</p>
                <button
                  onClick={handleCreateNote}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Plus className="h-4 w-4" />
                  Create your first note
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
