import React from "react";
import { Link } from "react-router-dom";

export default function SplitAuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row" style={{ backgroundColor: "#f9f9f9" }}>
      {/* Left — Image panel */}
      <div className="hidden lg:block lg:w-1/2 relative">
        <img
          src="https://media.base44.com/images/public/6a3c82cc9ebee978d8a2abbc/4254718b8_generated_c2f1f084.png"
          alt="Hands placing a ceramic vase on a white shelf in a minimalist studio"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-inkstone/50 via-inkstone/10 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-12">
          <Link to="/" className="text-white text-2xl tracking-tight font-normal">
            Webshop
          </Link>
          <p className="mt-4 text-white text-2xl font-normal leading-snug max-w-sm">
            The storefront is the new flagship.
          </p>
          <p className="mt-2 text-white/70 text-sm max-w-sm">
            Build stunning online stores in minutes. Sell everywhere your customers are.
          </p>
        </div>
      </div>

      {/* Right — Form panel */}
      <div className="flex-1 flex items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <Link to="/" className="lg:hidden block text-inkstone text-2xl tracking-tight font-normal mb-8">
            Webshop
          </Link>

          <div className="mb-8">
            <h1 className="text-inkstone text-3xl md:text-4xl font-normal tracking-tight leading-tight">
              {title}
            </h1>
            {subtitle && <p className="text-inkstone/60 text-base mt-2">{subtitle}</p>}
          </div>

          <div className="bg-paper rounded-lg border border-inkstone/[0.08] p-6 md:p-8">
            {children}
          </div>

          {footer && (
            <p className="text-center text-sm text-inkstone/60 mt-6">{footer}</p>
          )}
        </div>
      </div>
    </div>
  );
}