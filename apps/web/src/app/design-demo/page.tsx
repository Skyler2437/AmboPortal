"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Plus,
    Trash2,
    CheckCircle2,
    Circle,
    MoreVertical,
    Calendar,
    Users
} from "lucide-react";
import {
    Drawer,
    DrawerContent,
    DrawerHeader,
    DrawerTitle,
    DrawerDescription,
    DrawerFooter,
    DrawerClose
} from "@/components/ui/drawer";
import { MotionButton } from "@/components/ui/motion-button";
import { DateTimePicker } from "@/components/DateTimePicker";
import { cn } from "@/lib/utils";

// Mock Data
interface Task {
    id: string;
    title: string;
    assignee: string;
    due: string;
    status: "todo" | "done";
}

const initialTasks: Task[] = [
    { id: "1", title: "Review Q3 Marketing Plan", assignee: "Sarah", due: "Today", status: "todo" },
    { id: "2", title: "Update Team Roster", assignee: "Mike", due: "Tomorrow", status: "todo" },
    { id: "3", title: "Prepare Client Deck", assignee: "Jessica", due: "Fri", status: "todo" },
];

export default function DesignDemoPage() {
    const [tasks, setTasks] = useState<Task[]>(initialTasks);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    const toggleTaskStatus = (id: string) => {
        setTasks(prev => prev.map(t => {
            if (t.id === id) {
                return { ...t, status: t.status === "todo" ? "done" : "todo" };
            }
            return t;
        }));

        // Simulate "archiving" done tasks after a delay
        // In a real app, this might wait longer or happen on refresh
    };

    const removeTask = (id: string) => {
        setTasks(prev => prev.filter(t => t.id !== id));
    };

    const addNewTask = () => {
        const newTask: Task = {
            id: Date.now().toString(),
            title: "New Task Item",
            assignee: "You",
            due: "No Date",
            status: "todo"
        };
        setTasks(prev => [newTask, ...prev]);
        setIsDrawerOpen(false);
    };

    return (
        <div className="min-h-screen bg-gray-50 flex justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-3xl shadow-xl overflow-hidden flex flex-col h-[800px] relative border border-gray-100">

                {/* Header */}
                <header className="p-6 pb-2">
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">My Tasks</h1>
                            <p className="text-gray-500 text-sm">3 pending tasks today</p>
                        </div>
                        <div className="w-10 h-10 bg-brand-light rounded-full flex items-center justify-center text-brand font-bold">
                            SJ
                        </div>
                    </div>

                    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                        {["All", "Today", "Upcoming", "Done"].map((tab, i) => (
                            <motion.button
                                key={tab}
                                className={cn(
                                    "px-4 py-1.5 rounded-full text-sm font-medium transition-colors",
                                    i === 0 ? "bg-black text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                )}
                                whileTap={{ scale: 0.95 }}
                            >
                                {tab}
                            </motion.button>
                        ))}
                    </div>
                </header>

                {/* Task List */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    <AnimatePresence mode="popLayout">
                        {tasks.map((task) => (
                            <motion.div
                                key={task.id}
                                layout
                                initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                                whileTap={{ scale: 0.98 }}
                                className={cn(
                                    "group relative bg-white border border-gray-100 rounded-2xl p-4 shadow-sm transition-all",
                                    task.status === "done" && "bg-gray-50 opacity-60"
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    <motion.button
                                        whileTap={{ scale: 0.8 }}
                                        onClick={() => toggleTaskStatus(task.id)}
                                        className={cn(
                                            "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors",
                                            task.status === "done" ? "bg-green-500 border-green-500" : "border-gray-300"
                                        )}
                                    >
                                        {task.status === "done" && <CheckCircle2 className="w-4 h-4 text-white" />}
                                    </motion.button>

                                    <div className="flex-1">
                                        <h3 className={cn(
                                            "font-medium text-gray-900 transition-all",
                                            task.status === "done" && "line-through text-gray-500"
                                        )}>
                                            {task.title}
                                        </h3>
                                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                                            <span className="flex items-center gap-1">
                                                <Users className="w-3 h-3" /> {task.assignee}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Calendar className="w-3 h-3" /> {task.due}
                                            </span>
                                        </div>
                                    </div>

                                    <MotionButton
                                        size="icon"
                                        variant="ghost"
                                        className="text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={() => removeTask(task.id)}
                                    >
                                        <Trash2 className="w-4 h-4 text-red-400" />
                                    </MotionButton>
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>

                    {tasks.length === 0 && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="text-center py-10 text-gray-400"
                        >
                            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3">
                                <CheckCircle2 className="w-8 h-8 text-gray-300" />
                            </div>
                            <p>No tasks remaining</p>
                        </motion.div>
                    )}
                </div>

                {/* Floating Action Button */}
                <div className="absolute bottom-6 right-6">
                    <MotionButton
                        className="h-14 w-14 rounded-full bg-black text-white shadow-lg shadow-black/20"
                        onClick={() => setIsDrawerOpen(true)}
                    >
                        <Plus className="w-6 h-6" />
                    </MotionButton>
                </div>

                {/* Create Task Drawer (Vaul) */}
                <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
                    <DrawerContent>
                        <div className="mx-auto w-full max-w-md">
                            <DrawerHeader>
                                <DrawerTitle>Create New Task</DrawerTitle>
                                <DrawerDescription>Add a new item to your team&apos;s agenda.</DrawerDescription>
                            </DrawerHeader>

                            <div className="p-4 space-y-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Task Title</label>
                                    <input
                                        className="w-full px-3 py-2 border rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-black/5"
                                        placeholder="e.g. Review Designs"
                                    />
                                </div>

                                <div className="flex gap-2">
                                    <div className="flex-1 space-y-2">
                                        <label className="text-sm font-medium">Assignee</label>
                                        <select className="w-full px-3 py-2 border rounded-xl bg-gray-50">
                                            <option>Me</option>
                                            <option>Team</option>
                                        </select>
                                    </div>
                                    <div className="flex-1 space-y-2">
                                        <label htmlFor="task-due-date" className="text-sm font-medium">Due Date</label>
                                        <DateTimePicker id="task-due-date" mode="date" className="rounded-xl bg-gray-50" />
                                    </div>
                                </div>

                                <div className="pt-4">
                                    <MotionButton
                                        className="w-full rounded-xl h-12 text-base"
                                        onClick={addNewTask}
                                    >
                                        Create Task
                                    </MotionButton>
                                </div>
                            </div>
                            <DrawerFooter className="pt-0">
                                <DrawerClose asChild>
                                    <MotionButton variant="outline" className="w-full rounded-xl h-12">Cancel</MotionButton>
                                </DrawerClose>
                            </DrawerFooter>
                        </div>
                    </DrawerContent>
                </Drawer>

            </div>
        </div>
    );
}
