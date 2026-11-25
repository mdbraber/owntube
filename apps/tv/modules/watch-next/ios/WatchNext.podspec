Pod::Spec.new do |s|
  s.name           = 'WatchNext'
  s.version        = '1.0.0'
  s.summary        = 'Continue watching for the Apple TV Top Shelf'
  s.author         = 'OwnTube'
  s.homepage       = 'https://github.com/mdbraber/owntube'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '15.1', :tvos => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
