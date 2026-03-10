"use client";

import { createContext, type ReactNode, useContext, useState } from "react";

import type { Repo } from "@/vendor/pages-cms-fork/types/repo";

interface RepoContextType extends Repo {
  setBranches: (branches: string[]) => void;
}

const RepoContext = createContext<RepoContextType | undefined>(undefined);

export const useRepo = () => {
  const context = useContext(RepoContext);
  if (!context) {
    throw new Error("useRepo must be used within a RepoProvider");
  }

  return context;
};

export const RepoProvider = ({
  repo,
  children,
}: {
  repo: Repo;
  children: ReactNode;
}) => {
  const [branches, setBranches] = useState<string[]>(repo?.branches || []);

  return (
    <RepoContext.Provider value={{ ...repo, branches, setBranches }}>
      {children}
    </RepoContext.Provider>
  );
};
