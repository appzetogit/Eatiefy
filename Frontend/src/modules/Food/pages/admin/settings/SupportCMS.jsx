import { useState, useEffect } from "react";
import { toast } from "sonner";
import api from "@food/api";
import { Textarea } from "@food/components/ui/textarea";
import { legalHtmlToPlainText, plainTextToLegalHtml } from "@food/utils/legalContentFormat";

const debugError = (...args) => {};
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

export default function SupportCMS() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState("edit"); // "edit" | "preview"
  const [activeRole, setActiveRole] = useState("user"); // "user" | "restaurant" | "delivery"
  const [supportData, setSupportData] = useState({
    title: "Help & Support",
    content: "",
    email: "",
    mobile: "",
    faq: "",
  });
  const [initialData, setInitialData] = useState({
    title: "Help & Support",
    content: "",
    email: "",
    mobile: "",
    faq: "",
  });

  const hasChanges = JSON.stringify(supportData) !== JSON.stringify(initialData);

  useEffect(() => {
    fetchSupportData();
  }, [activeRole]);

  const fetchSupportData = async () => {
    try {
      setLoading(true);
      const key = `support_${activeRole}`;
      const response = await api.get(`/food/admin/pages-social-media/${key}`, {
        contextModule: "admin",
      });

      if (response.data.success && response.data.data) {
        const raw = response.data.data;
        const textContent = legalHtmlToPlainText(raw.content || "");
        const defaultFaq = `Q: How do I track my order?\nA: You can track your order in real-time through the 'My Orders' section in your profile.\n\nQ: What if I receive a wrong item?\nA: Please contact our support immediately via call or email with your order ID for a quick resolution.\n\nQ: Can I cancel my order?\nA: Orders can only be cancelled before the restaurant starts preparing your food.\n\nHOURS: Available 24/7 for emergency support. General inquiries: 9 AM - 11 PM.\nPRIVACY: Your conversations with our support team are encrypted and secure.`;
        const newData = {
          title: raw.title || "Help & Support",
          content: textContent,
          email: raw.email || "",
          mobile: raw.mobile || "",
          faq: raw.faq || defaultFaq,
        };
        setSupportData(newData);
        setInitialData(newData);
      } else {
        const emptyData = { title: "Help & Support", content: "", email: "", mobile: "", faq: "" };
        setSupportData(emptyData);
        setInitialData(emptyData);
      }
    } catch (error) {
      debugError("Error fetching support data:", error);
      if (error.response?.status === 404) {
        const emptyData = { title: "Help & Support", content: "", email: "", mobile: "", faq: "" };
        setSupportData(emptyData);
        setInitialData(emptyData);
      } else {
        toast.error("Failed to load support content");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const email = supportData.email.trim();
    const mobile = supportData.mobile.trim();
    if (email && !EMAIL_REGEX.test(email)) {
      toast.error("Please enter a valid support email address");
      return;
    }
    if (mobile) {
      const digits = mobile.replace(/\D/g, "");
      if (!/^\+?[\d\s\-()]+$/.test(mobile) || digits.length < 10 || digits.length > 15) {
        toast.error("Please enter a valid support mobile number (10-15 digits)");
        return;
      }
    }
    try {
      setSaving(true);
      const htmlContent = plainTextToLegalHtml(supportData.content);
      const key = `support_${activeRole}`;

      const response = await api.put(
        `/food/admin/pages-social-media/${key}`,
        {
          title: supportData.title,
          content: htmlContent,
          email: supportData.email,
          mobile: supportData.mobile,
          faq: supportData.faq,
        },
        { contextModule: "admin" }
      );

      if (response.data.success) {
        toast.success(
          `${activeRole.charAt(0).toUpperCase() + activeRole.slice(1)} support content updated successfully`
        );
        const raw = response.data.data;
        const textContent = legalHtmlToPlainText(raw.content || "");
        const savedData = {
          title: raw.title || "Help & Support",
          content: textContent,
          email: raw.email || "",
          mobile: raw.mobile || "",
          faq: raw.faq || supportData.faq,
        };
        setSupportData(savedData);
        setInitialData(savedData);
      }
    } catch (error) {
      debugError("Error saving support:", error);
      toast.error(error.response?.data?.message || "Failed to save support content");
    } finally {
      setSaving(false);
    }
  };

  const getRoleLabel = (role) => role.charAt(0).toUpperCase() + role.slice(1);

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-4 lg:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Help &amp; Support</h1>
            <p className="text-sm text-slate-600 mt-1">
              Manage module-specific Help &amp; Support content
            </p>
          </div>

          {/* Module Selector - same style as LegalTerms */}
          <div className="inline-flex p-1 bg-white border border-slate-200 rounded-xl shadow-sm">
            {["user", "restaurant", "delivery"].map((role) => (
              <button
                key={role}
                onClick={() => setActiveRole(role)}
                className={`px-6 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
                  activeRole === role
                    ? "bg-orange-500 text-white shadow-md shadow-orange-500/20"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {getRoleLabel(role)}
              </button>
            ))}
          </div>
        </div>

        {/* Contact Info */}
        {viewMode === "edit" && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-6">
          <div className="border-b border-slate-100 bg-slate-50/50 p-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span>
            <span className="text-sm font-medium text-slate-700">
              Contact Information — {getRoleLabel(activeRole)} Portal
            </span>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label
                htmlFor="support-email"
                className="block text-xs font-bold text-slate-400 uppercase tracking-wider"
              >
                Support Email
              </label>
              <input
                id="support-email"
                type="email"
                value={supportData.email}
                onChange={(e) =>
                  setSupportData((prev) => ({ ...prev, email: e.target.value }))
                }
                placeholder="support@example.com"
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-slate-700 font-medium"
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="support-mobile"
                className="block text-xs font-bold text-slate-400 uppercase tracking-wider"
              >
                Support Mobile
              </label>
              <input
                id="support-mobile"
                type="tel"
                inputMode="tel"
                maxLength={20}
                value={supportData.mobile}
                onChange={(e) =>
                  setSupportData((prev) => ({
                    ...prev,
                    mobile: e.target.value.replace(/[^\d+\s\-()]/g, ""),
                  }))
                }
                placeholder="+91 00000 00000"
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-slate-700 font-medium"
              />
            </div>
          </div>
        </div>
        )}

        {/* Content Editor */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-6">
          <div className="border-b border-slate-100 bg-slate-50/50 p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span>
              <span className="text-sm font-medium text-slate-700">
                {viewMode === "preview" ? "Previewing" : "Editing"} {getRoleLabel(activeRole)} Portal Support Content
              </span>
            </div>

            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
              <button
                type="button"
                onClick={() => setViewMode("edit")}
                className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  viewMode === "edit"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Editor
              </button>
              <button
                type="button"
                onClick={() => setViewMode("preview")}
                className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  viewMode === "preview"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Preview
              </button>
            </div>
          </div>

          <div className="p-6">
            {loading ? (
              <div className="min-h-[300px] flex flex-col items-center justify-center space-y-4">
                <div className="w-10 h-10 border-4 border-orange-500/30 border-t-orange-500 rounded-full animate-spin"></div>
                <p className="text-sm text-slate-500 font-medium italic">
                  Synchronizing content...
                </p>
              </div>
            ) : (
              <>
                {viewMode === "edit" && (
                  <div className="mb-4">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                      Page Title
                    </label>
                    <input
                      type="text"
                      value={supportData.title}
                      onChange={(e) =>
                        setSupportData((prev) => ({ ...prev, title: e.target.value }))
                      }
                      className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-slate-700 font-medium"
                    />
                  </div>
                )}

                {viewMode === "edit" ? (
                  <div className="relative group">
                    <Textarea
                      value={supportData.content}
                      onChange={(e) =>
                        setSupportData((prev) => ({ ...prev, content: e.target.value }))
                      }
                      placeholder={`Enter help & support content for ${activeRole} portal here...`}
                      className="min-h-[150px] w-full text-sm text-slate-700 leading-relaxed resize-y border-slate-200 group-focus-within:border-orange-500 transition-colors bg-slate-50/30"
                    />
                  </div>
                ) : (
                  <div className="min-h-[150px] w-full bg-white">
                    <div
                      className="prose prose-orange max-w-none prose-headings:text-slate-900 prose-headings:font-bold prose-p:text-slate-600 prose-p:leading-7 prose-strong:text-slate-900 prose-ul:text-slate-600 prose-li:my-2 bg-slate-50/30 rounded-xl border border-slate-100 p-8"
                      dangerouslySetInnerHTML={{
                        __html: plainTextToLegalHtml(supportData.content),
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* FAQ Editor Box */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/50 p-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span>
            <span className="text-sm font-medium text-slate-700">
              FAQ (Frequently Asked Questions) — {getRoleLabel(activeRole)} Portal
            </span>
          </div>
          <div className="p-6">
            {loading ? (
              <div className="min-h-[150px] flex flex-col items-center justify-center space-y-4">
                <div className="w-8 h-8 border-4 border-orange-500/30 border-t-orange-500 rounded-full animate-spin"></div>
              </div>
            ) : viewMode === "edit" ? (
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 leading-relaxed">
                  Format: Write question starting with <span className="text-slate-600">Q:</span> and answer starting with <span className="text-slate-600">A:</span>
                  <br />
                  For Info Cards: Use <span className="text-slate-600">HOURS:</span> for Operational Hours and <span className="text-slate-600">PRIVACY:</span> for Data Privacy.
                </label>
                <Textarea
                  value={supportData.faq}
                  onChange={(e) =>
                    setSupportData((prev) => ({ ...prev, faq: e.target.value }))
                  }
                  placeholder="Q: Question here?\nA: Answer here...\n\nHOURS: 9 AM - 11 PM\nPRIVACY: Safe and secure"
                  className="min-h-[150px] w-full text-sm text-slate-700 leading-relaxed resize-y border-slate-200 focus-within:border-orange-500 transition-colors bg-slate-50/30 font-medium"
                />
              </div>
            ) : (
              <div className="min-h-[150px] w-full bg-slate-50/30 rounded-xl border border-slate-100 p-6">
                {(() => {
                  const lines = (supportData.faq || "").split("\n").map((l) => l.trim()).filter(Boolean);
                  const parsed = [];
                  let currentQ = null;
                  let hoursText = "Available 24/7 for emergency support. General inquiries: 9 AM - 11 PM.";
                  let privacyText = "Your conversations with our support team are encrypted and secure.";

                  for (const line of lines) {
                    if (line.startsWith("Q:")) currentQ = line.substring(2).trim();
                    else if (line.startsWith("A:") && currentQ) {
                      parsed.push({ q: currentQ, a: line.substring(2).trim() });
                      currentQ = null;
                    } else if (line.startsWith("HOURS:")) hoursText = line.substring(6).trim();
                    else if (line.startsWith("PRIVACY:")) privacyText = line.substring(8).trim();
                  }

                  return (
                    <div className="space-y-6">
                      {parsed.map((faq, idx) => (
                        <div key={idx} className="space-y-1.5">
                          <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                            <span className="text-orange-500">Q.</span> {faq.q}
                          </h4>
                          <p className="text-sm text-slate-600 pl-6 border-l-2 border-slate-200 ml-1.5 py-0.5">{faq.a}</p>
                        </div>
                      ))}
                      {(parsed.length === 0) && (
                        <div className="text-sm text-slate-700 whitespace-pre-wrap bg-white p-4 rounded-lg border border-slate-200">
                          {supportData.faq ? supportData.faq : <span className="text-slate-400 italic">No FAQs configured yet.</span>}
                        </div>
                      )}
                      <div className="mt-8 pt-6 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="text-sm text-slate-600 bg-white p-4 rounded-lg border border-slate-100 shadow-sm">
                          <strong className="block text-xs text-slate-900 uppercase tracking-wider mb-1">Operational Hours</strong>
                          {hoursText}
                        </div>
                        <div className="text-sm text-slate-600 bg-white p-4 rounded-lg border border-slate-100 shadow-sm">
                          <strong className="block text-xs text-slate-900 uppercase tracking-wider mb-1">Data Privacy</strong>
                          {privacyText}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>

        {/* Save Button */}
        {viewMode === "edit" && (
          <div className="flex items-center justify-between mt-8 p-6 bg-white border border-slate-200 rounded-2xl shadow-sm">
          <div className="text-sm text-slate-500">
            <span className="font-semibold text-slate-700">Tip:</span> Your changes are only
            published once you hit save.
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || loading || !hasChanges}
            className="flex items-center gap-2 px-8 py-3 bg-orange-500 text-white rounded-xl hover:bg-orange-600 transition-all duration-200 font-bold shadow-lg shadow-orange-500/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none group"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
        )}
      </div>
    </div>
  );
}
