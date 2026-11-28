import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { adminAPI } from "@food/api";
import { setAuthData } from "@food/utils/auth";
import { registerWebPushForCurrentModule } from "@food/utils/firebaseMessaging";
import { User, Lock, Loader2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";


// Reusable Input Component (Inline)
function LoginInput({
  label,
  icon: Icon,
  type = "text",
  placeholder = "",
  value,
  onChange,
  error,
  required = false,
  ...props
}) {
  const isPassword = type === "password";
  const [showPassword, setShowPassword] = useState(false);
  const inputType = isPassword ? (showPassword ? "text" : "password") : type;

  return (
    <div className="flex flex-col w-full font-poppins">
      {label && (
        <label className="text-white text-[12px] md:text-[14px] font-normal tracking-wide mb-1.5 md:mb-2">
          {label}
        </label>
      )}
      <div
        className={`w-full h-[42px] md:h-[50px] bg-white/10 md:bg-white/20 hover:bg-white/15 md:hover:bg-white/25 focus-within:bg-white/20 md:focus-within:bg-white/30 transition-all duration-300 rounded-full flex items-center px-1.5 border border-white/10 md:border-transparent hover:border-white/20 md:hover:border-transparent focus-within:border-white/30 md:focus-within:border-transparent shadow-inner md:shadow-none ${
          error ? "border-red-400 focus-within:ring-red-400/20" : ""
        }`}
      >
        {/* Left Icon Circle */}
        {Icon && (
          <div className="w-[30px] h-[30px] md:w-[38px] md:h-[38px] rounded-full bg-gradient-to-br from-[#1B4332] to-[#0B2E1F] md:bg-none md:bg-[#14532D] flex items-center justify-center text-white shrink-0 shadow-md md:shadow-sm shadow-black/10">
            <Icon size={15} className="md:scale-[1.2]" />
          </div>
        )}

        {/* Text Input with class to force transparency */}
        <input
          type={inputType}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
          className="login-input-field bg-transparent text-white placeholder-white/50 text-[13px] md:text-[15px] h-full flex-1 px-2.5 md:px-3 border-none outline-none focus:outline-none focus:ring-0 focus:border-none focus:bg-transparent"
          {...props}
        />

        {/* Right Password Toggle Icon */}
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="w-[30px] h-[30px] md:w-[38px] md:h-[38px] flex items-center justify-center text-white/60 hover:text-white transition-colors duration-200 shrink-0 focus:outline-none mr-1"
          >
            {showPassword ? <EyeOff size={15} className="md:scale-[1.2]" /> : <Eye size={15} className="md:scale-[1.2]" />}
          </button>
        )}
      </div>

      {error && (
        <span className="text-red-200 text-[10px] md:text-xs font-normal mt-1 pl-4 transition-all duration-300 animate-fadeIn">
          {error}
        </span>
      )}
    </div>
  );
}

// Reusable Button Component (Inline)
function LoginButton({
  children,
  onClick,
  type = "submit",
  disabled = false,
  loading = false,
  ...props
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className="w-[160px] md:w-[220px] h-[40px] md:h-[48px] rounded-full bg-white/20 hover:bg-white/25 focus:bg-white/35 border border-white/20 backdrop-blur-md text-white text-[13px] md:text-[16px] font-semibold font-poppins tracking-wider shadow-md hover:shadow-lg transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-75 disabled:cursor-not-allowed flex items-center justify-center"
      {...props}
    >
      {loading ? <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" /> : children}
    </button>
  );
}


// Main Export Component
export default function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const submitting = useRef(false);
  const [isDesktop, setIsDesktop] = useState(true);

  // Responsiveness tracker for conditional clip-path
  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 768);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setErrors({});

    let newErrors = {};
    if (!email) newErrors.email = "Username is required";
    if (!password) newErrors.password = "Password is required";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      toast.error("Please fill in all fields");
      return;
    }

    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);

    try {
      const response = await adminAPI.login(email.trim(), password);
      const data = response?.data?.data || response?.data || {};

      const accessToken = data.accessToken;
      const adminUser = data.user || data.admin;
      const refreshToken = data.refreshToken ?? null;

      if (!accessToken || !adminUser || !refreshToken) {
        throw new Error("Invalid response from server");
      }

      setAuthData("admin", accessToken, adminUser, refreshToken);
      void registerWebPushForCurrentModule("/admin/food").catch(() => {});
      toast.success("Welcome, Administrator");
      navigate("/admin/food", { replace: true });
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        "Login failed. Check your credentials.";
      toast.error(msg);
    } finally {
      setLoading(false);
      submitting.current = false;
    }
  };

  return (
    <div className="w-screen h-screen flex flex-col-reverse md:flex-row overflow-hidden font-poppins bg-white relative">
      <style>{`
        /* Override Chrome Autofill styling */
        input:-webkit-autofill,
        input:-webkit-autofill:hover, 
        input:-webkit-autofill:focus, 
        input:-webkit-autofill:active  {
          -webkit-text-fill-color: white !important;
          -webkit-box-shadow: 0 0 0px 1000px transparent inset !important;
          transition: background-color 5000s ease-in-out 0s !important;
        }
        /* Override global preflight inputs and borders */
        .login-input-field {
          background-color: transparent !important;
          background: transparent !important;
          border: none !important;
          outline: none !important;
          box-shadow: none !important;
        }
        .login-input-field:focus {
          background-color: transparent !important;
          background: transparent !important;
          border: none !important;
          outline: none !important;
          box-shadow: none !important;
        }
        .premium-heading {
          font-family: 'Outfit', sans-serif !important;
          font-weight: 800 !important;
          letter-spacing: 0.25em !important;
          background: linear-gradient(135deg, #FFFFFF 0%, #E8C86A 100%) !important;
          -webkit-background-clip: text !important;
          -webkit-text-fill-color: transparent !important;
          text-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        }
      `}</style>

      {/* SVG Wave Clip Path Definition */}
      <svg className="absolute w-0 h-0">
        <defs>
          <clipPath id="wave-clip" clipPathUnits="objectBoundingBox">
            <path d="M 0.13,0 C 0.13,0.08 0.24,0.1 0.24,0.18 C 0.24,0.26 0.16,0.38 0.16,0.5 C 0.16,0.62 0.28,0.7 0.28,0.82 C 0.28,0.92 0.24,0.96 0.24,1 L 1,1 L 1,0 Z" />
          </clipPath>
        </defs>
      </svg>

      {/* LEFT SECTION (54% desktop, hidden on mobile) */}
      <div className="hidden md:flex w-full md:w-[54%] h-[45vh] md:h-full bg-white relative items-center justify-center overflow-hidden shrink-0 z-0">
        <img
          src="/assets/images/adminloginpagedesign.webp"
          alt="Login Illustration"
          className="w-full h-full object-contain scale-[0.86] md:-translate-x-10"
          style={{ filter: "hue-rotate(105deg) saturate(0.85)" }}
        />
      </div>

      {/* RIGHT SECTION CONTENT (46% desktop, full h-screen on mobile) */}
      <div className={`w-full md:w-[46%] h-screen md:h-full relative flex flex-col justify-center items-center px-4 sm:px-12 md:px-16 lg:px-24 shrink-0 z-20 overflow-hidden ${!isDesktop ? "bg-gradient-to-br from-[#0B2E1F] via-[#14532D] to-[#0B2E1F]" : "bg-transparent"}`}>
        {/* Ambient Glow Blobs (Mobile only) */}
        <div className="absolute -top-20 -left-20 w-[280px] h-[280px] rounded-full bg-[#D4AF37]/20 blur-[60px] pointer-events-none md:hidden" />
        <div className="absolute -bottom-20 -right-20 w-[300px] h-[300px] rounded-full bg-[#D4AF37]/15 blur-[70px] pointer-events-none md:hidden" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] rounded-full bg-white/5 blur-[90px] pointer-events-none md:hidden" />

        <form onSubmit={handleLogin} className="w-full max-w-[350px] sm:max-w-[380px] p-7 sm:p-9 md:p-0 rounded-[2rem] md:rounded-none bg-white/10 md:bg-transparent backdrop-blur-xl md:backdrop-blur-none border border-white/10 md:border-none shadow-2xl md:shadow-none shadow-black/25 flex flex-col items-center -mt-16 md:-mt-16 z-10">
          {/* Brand & Heading */}
          <div className="mb-6 md:mb-8 text-center flex flex-col items-center select-none">
            <h1 className="text-[38px] sm:text-[44px] md:text-[48px] leading-none font-extrabold bg-gradient-to-r from-[#C9962F] via-[#E8C87A] to-[#A8761D] bg-clip-text text-transparent tracking-tight font-['Outfit'] mb-1.5 drop-shadow-sm">
              Eatiefy
            </h1>
            <h2 className="text-[20px] sm:text-[23px] md:text-[26px] font-extrabold text-white tracking-tight font-['Outfit'] drop-shadow-sm">
              Admin Panel
            </h2>
          </div>

          {/* Inputs */}
          <div className="w-full space-y-3 md:space-y-5 mb-5 md:mb-8">
            <LoginInput
              label="Username"
              icon={User}
              type="text"
              placeholder=""
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.email}
            />
            <LoginInput
              label="Password"
              icon={Lock}
              type="password"
              placeholder=""
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
            />
          </div>

          {/* Submit Button */}
          <LoginButton loading={loading}>
            LOGIN
          </LoginButton>
        </form>
      </div>

      {/* RIGHT BACKGROUND WAVE OVERLAY (Direct Sibling, NOT clipped by right container!) */}
      <div
        className={`absolute top-0 right-0 h-full w-[59vw] bg-gradient-to-br from-[#0B2E1F] via-[#14532D] to-[#1F7A4D] z-10 pointer-events-none ${isDesktop ? "block" : "hidden"}`}
        style={{
          clipPath: isDesktop ? "url(#wave-clip)" : "none",
        }}
      />
    </div>
  );
}




