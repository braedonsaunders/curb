"use client";

import { createContext, type ReactNode, useContext, useState } from "react";

import type { ForkConfig } from "@/vendor/pages-cms-fork/types/config";

interface ConfigContextType {
  config: ForkConfig | null;
  setConfig: (config: ForkConfig | null) => void;
}

const ConfigContext = createContext<ConfigContextType | null>(null);

export const useConfig = () => {
  const context = useContext(ConfigContext);
  if (!context) {
    throw new Error("useConfig must be used within a ConfigProvider");
  }

  return context;
};

export const ConfigProvider = ({
  value,
  children,
}: {
  value: ForkConfig | null;
  children: ReactNode;
}) => {
  const [config, setConfig] = useState<ForkConfig | null>(value);

  return (
    <ConfigContext.Provider value={{ config, setConfig }}>
      {children}
    </ConfigContext.Provider>
  );
};
