import { useEffect } from "react";

interface UseOpenUploadQueryParams {
  pathname: string;
  search: string;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  onOpenUpload: () => void;
}

export default function useOpenUploadQuery({
  pathname,
  search,
  navigate,
  onOpenUpload,
}: UseOpenUploadQueryParams) {
  useEffect(() => {
    const query = new URLSearchParams(search);
    if (query.get("openUpload") !== "1") {
      return;
    }

    onOpenUpload();
    query.delete("openUpload");
    const next = query.toString();
    navigate(`${pathname}${next ? `?${next}` : ""}`, { replace: true });
  }, [navigate, onOpenUpload, pathname, search]);
}