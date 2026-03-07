import { ThemeProvider, CssBaseline, Box } from '@mui/material';
import theme from './theme/theme';
import Navbar from './components/layout/Navbar';
import Footer from './components/layout/Footer';
import Hero from './components/sections/Hero';
import About from './components/sections/About';
import Experience from './components/sections/Experience';
import Skills from './components/sections/Skills';
import Projects from './components/sections/Projects';
import SystemDesign from './components/sections/SystemDesign';
import Blog from './components/sections/Blog';
import Contact from './components/sections/Contact';

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', overflowX: 'hidden' }}>
        <Navbar />
        <main>
          <Hero />
          <About />
          <Experience />
          <Skills />
          <Projects />
          <SystemDesign />
          <Blog />
          <Contact />
        </main>
        <Footer />
      </Box>
    </ThemeProvider>
  );
}
