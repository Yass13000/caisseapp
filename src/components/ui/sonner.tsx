import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-secondary group-[.toaster]:text-white group-[.toaster]:border-secondary group-[.toaster]:shadow-lg font-helvetica",
          description: "group-[.toast]:text-white/90 font-helvetica",
          actionButton:
            "group-[.toast]:bg-cream group-[.toast]:text-secondary font-helvetica",
          cancelButton:
            "group-[.toast]:bg-white/20 group-[.toast]:text-white font-helvetica",
          success: "group-[.toaster]:bg-secondary group-[.toaster]:text-white",
          error: "group-[.toaster]:bg-secondary group-[.toaster]:text-white",
          warning: "group-[.toaster]:bg-secondary group-[.toaster]:text-white",
          info: "group-[.toaster]:bg-secondary group-[.toaster]:text-white",
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
