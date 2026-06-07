import { create } from 'zustand';
import type { Project, ProjectListItem } from '@/types/project';

interface ProjectState {
  // 项目列表
  projects: ProjectListItem[];
  currentProject: Project | null;
  isLoading: boolean;

  // Actions
  setProjects: (projects: ProjectListItem[]) => void;
  setCurrentProject: (project: Project | null) => void;
  addProject: (project: ProjectListItem) => void;
  removeProject: (id: string) => void;
  updateProject: (id: string, updates: Partial<ProjectListItem>) => void;
  setLoading: (loading: boolean) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  currentProject: null,
  isLoading: false,

  setProjects: (projects: ProjectListItem[]) => set({ projects }),
  setCurrentProject: (project: Project | null) => set({ currentProject: project }),
  addProject: (project: ProjectListItem) =>
    set((state) => ({ projects: [project, ...state.projects] })),
  removeProject: (id: string) =>
    set((state) => ({ projects: state.projects.filter((p) => p.id !== id) })),
  updateProject: (id: string, updates: Partial<ProjectListItem>) =>
    set((state) => ({
      projects: state.projects.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    })),
  setLoading: (loading: boolean) => set({ isLoading: loading }),
}));
