ENV['RACK_ENV'] = 'test'

require 'minitest/autorun'
require 'rack/mock_request'
require_relative 'app'

class SinatraHostAuthorizationTest < Minitest::Test
  def test_allows_reverse_proxy_host_header
    response = Rack::MockRequest.new(Sinatra::Application).get(
      '/health',
      'HTTP_HOST' => 'ruby-sinatra.test.serverops.cloud'
    )

    assert_equal 200, response.status
    assert_equal 'OK', response.body
  end
end