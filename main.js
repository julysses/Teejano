// TEEJANO - Main JavaScript
// Texas Roots. Modern Style.

document.addEventListener('DOMContentLoaded', () => {
  initMobileMenu();
  initSmoothScroll();
  initScrollAnimations();
  initCartInteractions();
  initHeaderScroll();
});

// Mobile Menu Toggle
function initMobileMenu() {
  const menuBtn = document.querySelector('.mobile-menu-btn');
  const navList = document.querySelector('.nav-list');
  
  if (!menuBtn || !navList) return;
  
  menuBtn.addEventListener('click', () => {
    navList.classList.toggle('active');
    menuBtn.classList.toggle('active');
  });
}

// Smooth Scroll for Anchor Links
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      
      if (target) {
        const headerHeight = document.querySelector('.header').offsetHeight;
        const targetPosition = target.offsetTop - headerHeight;
        
        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
      }
    });
  });
}

// Scroll Animations
function initScrollAnimations() {
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-fade-in-up');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);
  
  // Observe product cards
  document.querySelectorAll('.product-card').forEach((card, index) => {
    card.style.opacity = '0';
    card.style.animationDelay = `${index * 100}ms`;
    observer.observe(card);
  });
  
  // Observe crafted section
  const craftedContent = document.querySelector('.crafted-content');
  if (craftedContent) {
    craftedContent.style.opacity = '0';
    observer.observe(craftedContent);
  }
}

// Cart Interactions
function initCartInteractions() {
  const addToCartButtons = document.querySelectorAll('.add-to-cart');
  
  addToCartButtons.forEach(button => {
    button.addEventListener('click', function() {
      const originalText = this.textContent;
      
      // Visual feedback
      this.textContent = 'Added!';
      this.style.backgroundColor = 'var(--color-primary)';
      this.style.color = 'var(--color-white)';
      
      // Reset after animation
      setTimeout(() => {
        this.textContent = originalText;
        this.style.backgroundColor = '';
        this.style.color = '';
      }, 1500);
      
      // Animate cart button
      const cartBtn = document.querySelector('.cart-btn');
      if (cartBtn) {
        cartBtn.style.transform = 'scale(1.1)';
        setTimeout(() => {
          cartBtn.style.transform = '';
        }, 200);
      }
    });
  });
}

// Header Scroll Effect
function initHeaderScroll() {
  const header = document.querySelector('.header');
  let lastScrollY = window.scrollY;
  
  window.addEventListener('scroll', () => {
    const currentScrollY = window.scrollY;
    
    // Add shadow when scrolled
    if (currentScrollY > 10) {
      header.style.boxShadow = '0 2px 20px rgba(0,0,0,0.1)';
    } else {
      header.style.boxShadow = 'none';
    }
    
    lastScrollY = currentScrollY;
  });
}

// Add CSS for mobile menu active state
const style = document.createElement('style');
style.textContent = `
  @media (max-width: 768px) {
    .nav-list.active {
      display: flex;
      position: absolute;
      top: 72px;
      left: 0;
      right: 0;
      flex-direction: column;
      background-color: var(--color-cream);
      padding: var(--space-lg);
      gap: var(--space-md);
      border-bottom: 1px solid var(--color-border);
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }
    
    .mobile-menu-btn.active span:nth-child(1) {
      transform: rotate(45deg) translate(5px, 5px);
    }
    
    .mobile-menu-btn.active span:nth-child(2) {
      opacity: 0;
    }
    
    .mobile-menu-btn.active span:nth-child(3) {
      transform: rotate(-45deg) translate(5px, -5px);
    }
  }
`;
document.head.appendChild(style);
